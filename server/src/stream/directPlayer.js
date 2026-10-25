import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { db } from '../db/database.js';

/**
 * Stream a remote URL (such as Gofile or cloud CDN) directly to client with HTTP 206 Range support
 */
function streamRemoteDirectPlay(req, res, streamUrl, contentType = 'video/mp4') {
  try {
    const parsed = new URL(streamUrl);
    const clientModule = parsed.protocol === 'http:' ? http : https;

    const headers = {
      'User-Agent': 'NovaPlex/1.0 AppleVision/MediaServer'
    };

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    if (streamUrl.includes('gofile.io') || streamUrl.includes('.gofile.')) {
      const token = db.queryOne("SELECT value FROM server_settings WHERE key = 'gofile_token'")?.value || process.env.GOFILE_TOKEN || '';
      headers['Authorization'] = `Bearer ${token}`;
    }

    const upstreamReq = clientModule.request(streamUrl, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      timeout: 30000
    }, (upstreamRes) => {
      // Follow redirects (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location) {
        return streamRemoteDirectPlay(req, res, upstreamRes.headers.location, contentType);
      }

      const resHeaders = {
        'Content-Type': upstreamRes.headers['content-type'] || contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      };

      if (upstreamRes.headers['content-range']) {
        resHeaders['Content-Range'] = upstreamRes.headers['content-range'];
      }
      if (upstreamRes.headers['content-length']) {
        resHeaders['Content-Length'] = upstreamRes.headers['content-length'];
      }

      res.writeHead(upstreamRes.statusCode || 200, resHeaders);

      if (req.method === 'HEAD') {
        return res.end();
      }

      upstreamRes.pipe(res);

      upstreamRes.on('error', (err) => {
        console.error('[DirectPlay] Remote stream pipe error:', err.message);
        if (!res.headersSent) res.status(502).end();
      });
    });

    upstreamReq.on('error', (err) => {
      console.error('[DirectPlay] Remote request error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to stream from remote cloud storage', details: err.message });
      }
    });

    // Abort upstream connection if client disconnects or seeks
    req.on('close', () => {
      upstreamReq.destroy();
    });

    upstreamReq.end();
  } catch (err) {
    console.error('[DirectPlay] Error initiating remote stream:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal streaming error', details: err.message });
    }
  }
}

/**
 * Direct Play streaming handler using HTTP 206 Partial Content (HTTP Range)
 * Zero CPU overhead, maximum bitrate, bit-for-bit 4K HDR10+ passthrough
 */
export function streamDirectPlay(req, res, filePath, contentType = 'video/mp4') {
  if (!filePath) {
    return res.status(404).json({ error: 'Media file not specified' });
  }

  // Handle .strm Cloud Video Streaming
  const isStrm = typeof filePath === 'string' && filePath.toLowerCase().endsWith('.strm');
  if (isStrm && fs.existsSync(filePath)) {
    try {
      const streamUrl = fs.readFileSync(filePath, 'utf-8').trim();
      if (streamUrl.startsWith('http://') || streamUrl.startsWith('https://')) {
        return streamRemoteDirectPlay(req, res, streamUrl, contentType);
      }
    } catch (err) {
      console.error('[DirectPlay] Error reading .strm file:', err.message);
    }
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Media file not found on disk' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).send('Requested range not satisfiable');
    }

    const chunkSize = (end - start) + 1;
    const fileStream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });

    if (req.method === 'HEAD') {
      return res.end();
    }

    fileStream.pipe(res);
    fileStream.on('error', (err) => {
      console.error('[DirectPlay] File stream pipe error:', err.message);
      if (!res.headersSent) res.status(500).end();
    });
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });

    if (req.method === 'HEAD') {
      return res.end();
    }

    fs.createReadStream(filePath).pipe(res);
  }
}
