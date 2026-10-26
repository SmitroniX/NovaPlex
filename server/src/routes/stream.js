import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/database.js';
import { streamDirectPlay } from '../stream/directPlayer.js';
import { streamRemux } from '../stream/remuxer.js';
import { getOrCreateHlsSession, touchHlsSession, PROFILES, checkIsH264 } from '../stream/hlsTranscoder.js';
import { streamSubtitles } from '../stream/subtitleServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TRANSCODE_ROOT = path.resolve(__dirname, '../../data/transcode');

const router = express.Router();

function getFilePath(mediaId, episodeId) {
  if (episodeId) {
    const ep = db.queryOne('SELECT file_path FROM tv_episodes WHERE id = ?', [episodeId]);
    if (ep) return ep.file_path;
  }

  // Check if mediaId is an episode directly
  const epDirect = db.queryOne('SELECT file_path FROM tv_episodes WHERE id = ?', [mediaId]);
  if (epDirect) return epDirect.file_path;

  // Check movie
  const movie = db.queryOne('SELECT file_path FROM media_items WHERE id = ?', [mediaId]);
  if (movie?.file_path) return movie.file_path;

  // If mediaId is a TV show and no episode was passed, default to first episode
  const firstEp = db.queryOne(
    'SELECT file_path FROM tv_episodes WHERE show_id = ? ORDER BY episode_number ASC LIMIT 1',
    [mediaId]
  );
  return firstEp?.file_path || null;
}

// 1. Direct Play (HTTP Range 206, 0% CPU, 4K HDR10+ bit-for-bit passthrough)
router.all('/direct/:mediaId', (req, res) => {
  const { episodeId } = req.query;
  const filePath = getFilePath(req.params.mediaId, episodeId);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Media file not found on disk' });
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.ts': 'video/MP2T',
    '.strm': 'video/mp4'
  };
  const mime = mimeMap[ext] || 'video/mp4';

  streamDirectPlay(req, res, filePath, mime);
});

// 2. Direct Remux (ffmpeg -c copy MKV->fMP4 container swap, ~0.5% CPU)
router.all('/remux/:mediaId', (req, res) => {
  const { episodeId, start = 0, audioTrack } = req.query;
  const filePath = getFilePath(req.params.mediaId, episodeId);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Media file not found on disk' });
  }

  streamRemux(req, res, filePath, parseFloat(start), audioTrack);
});

// Helper to serve single variant playlist
async function serveVariantPlaylist(req, res, mediaId, episodeId, quality, hdr, start, audioTrack, hevc = '1') {
  const filePath = getFilePath(mediaId, episodeId);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Media file not found on disk' });
  }

  let targetId = episodeId || mediaId;
  if (!episodeId) {
    const epRow = db.queryOne('SELECT id FROM tv_episodes WHERE file_path = ?', [filePath]);
    if (epRow) targetId = epRow.id;
  }

  let effectiveQuality = quality;
  if (quality === 'auto') {
    const isH264 = checkIsH264(filePath, targetId);
    const clientCanHevc = hevc === 'true' || hevc === '1';

    if (isH264 || clientCanHevc) {
      effectiveQuality = 'direct';
    } else {
      effectiveQuality = '720p'; // Optimal real-time transcode for non-HEVC clients
    }
  }

  const session = await getOrCreateHlsSession(targetId, filePath, effectiveQuality, hdr, parseFloat(start || 0), audioTrack, hevc);
  if (!session || !fs.existsSync(session.playlistPath)) {
    return res.status(500).json({ error: 'Failed to initialize HLS transcode session' });
  }

  const playlist = fs.readFileSync(session.playlistPath, 'utf-8');
  // Rewrite segment lines to route through /api/stream/hls/segment/:sessionKey/:segmentFile
  const rewritten = playlist.replace(/(segment-\d+\.ts)/g, `/api/stream/hls/segment/${session.key}/$1`);

  res.writeHead(200, {
    'Content-Type': 'application/vnd.apple.mpegurl',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  });
  res.end(rewritten);
}

// 3. Adaptive HLS Transcoder Master Playlist (Single-session optimal delivery to prevent multi-stream CPU thrashing)
router.get('/hls/:mediaId/master.m3u8', async (req, res) => {
  try {
    const { episodeId, quality = 'auto', hdr = 'auto', start = 0, audioTrack, hevc = '1' } = req.query;

    // Serve optimal single-variant stream directly to avoid parallel multi-stream CPU thrashing
    await serveVariantPlaylist(req, res, req.params.mediaId, episodeId, quality, hdr, start, audioTrack, hevc);
  } catch (err) {
    console.error('[StreamRoute] HLS error:', err);
    res.status(500).json({ error: 'Failed to transcode stream', message: err.message });
  }
});

// 3.1 Serve specific variant stream playlist for ABR
router.get('/hls/:mediaId/variant.m3u8', async (req, res) => {
  try {
    const { episodeId, quality = '1080p', hdr = 'auto', start = 0, audioTrack, hevc = '1' } = req.query;
    await serveVariantPlaylist(req, res, req.params.mediaId, episodeId, quality, hdr, start, audioTrack, hevc);
  } catch (err) {
    console.error('[StreamRoute] Variant HLS error:', err);
    res.status(500).json({ error: 'Failed to stream variant', message: err.message });
  }
});

// 3.2 Serve individual HLS segment (with quick poll safety to eliminate race 404s)
router.get('/hls/segment/:sessionKey/:segmentFile', async (req, res) => {
  const { sessionKey, segmentFile } = req.params;
  const segmentPath = path.join(TRANSCODE_ROOT, sessionKey, segmentFile);

  // Quick poll if segment is currently being finalized to disk
  let exists = fs.existsSync(segmentPath);
  if (!exists) {
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (fs.existsSync(segmentPath) && fs.statSync(segmentPath).size > 0) {
        exists = true;
        break;
      }
    }
  }

  if (!exists) {
    return res.status(404).end();
  }

  touchHlsSession(sessionKey);

  res.writeHead(200, {
    'Content-Type': 'video/MP2T',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600'
  });
  fs.createReadStream(segmentPath).pipe(res);
});

// 4. On-the-Fly WebVTT Subtitle Stream (with timing offset support)
router.get('/subtitles/:mediaId/:streamIndex.vtt', (req, res) => {
  const { episodeId, offset = 0 } = req.query;
  const filePath = getFilePath(req.params.mediaId, episodeId);
  const streamIndex = parseInt(req.params.streamIndex, 10) || 0;

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send('Media file not found');
  }

  streamSubtitles(req, res, filePath, streamIndex, parseFloat(offset || 0));
});

export default router;
