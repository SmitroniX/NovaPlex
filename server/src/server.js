import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { db } from './db/database.js';
import { scanner } from './scanner/fileScanner.js';
import { analyzeMediaFile } from './scanner/ffprobeAnalyzer.js';
import { getHardwareAccelerationInfo, terminateHlsSession } from './stream/hlsTranscoder.js';
import librariesRouter from './routes/libraries.js';
import mediaRouter from './routes/media.js';
import streamRouter from './routes/stream.js';
import usersRouter from './routes/users.js';
import playbackRouter from './routes/playback.js';
import settingsRouter from './routes/settings.js';
import systemRouter from './routes/system.js';
import gofileRouter from './routes/gofile.js';
import { runKeepAliveHeartbeat } from './scanner/gofileSync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5050;

app.use(cors());
app.use(express.json());

// 1. Serve cached remote images locally
const IMAGE_CACHE_DIR = path.resolve(__dirname, '../data/cache/images');
if (!fs.existsSync(IMAGE_CACHE_DIR)) {
  fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
}
app.use('/api/cache/images', express.static(IMAGE_CACHE_DIR));

// 2. Mount API Routes
app.use('/api/libraries', librariesRouter);
app.use('/api/media', mediaRouter);
app.use('/api/stream', streamRouter);
app.use('/api/users', usersRouter);
app.use('/api/playback', playbackRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/system', systemRouter);
app.use('/api/gofile', gofileRouter);

// 3. Health & Status endpoint
app.get('/api/health', (req, res) => {
  const hwInfo = getHardwareAccelerationInfo();
  res.json({
    status: 'online',
    server: 'NovaPlex',
    version: '1.0.0',
    capabilities: {
      transcoding4K: true,
      hdr10: true,
      hdr10Plus: true,
      hdrToSdrTonemap: true,
      directPlay: true,
      remux: true,
      adaptiveBitrate: true,
      hardwareAcceleration: hwInfo.mode,
      isHardwareAccelerated: hwInfo.isHardwareAccelerated
    }
  });
});

// 4. Serve Client static build if available
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// 5. Transcode Cache Housekeeping Worker
export function runTranscodeCacheHousekeeping() {
  const TRANSCODE_DIR = path.resolve(__dirname, '../data/transcode');
  if (!fs.existsSync(TRANSCODE_DIR)) return { prunedCount: 0, freedBytes: 0 };

  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB minimum free storage threshold
  const now = Date.now();
  let prunedCount = 0;
  let freedBytes = 0;

  try {
    const entries = fs.readdirSync(TRANSCODE_DIR, { withFileTypes: true });
    let freeBytes = Infinity;
    try {
      const statFs = fs.statfsSync(TRANSCODE_DIR);
      freeBytes = statFs.bavail * statFs.bsize;
    } catch (_) {}

    const isStorageLow = freeBytes < MIN_FREE_BYTES;

    const sessionDirs = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const fullPath = path.join(TRANSCODE_DIR, e.name);
        let mtime = 0;
        let size = 0;
        try {
          const s = fs.statSync(fullPath);
          mtime = s.mtimeMs;
          const files = fs.readdirSync(fullPath);
          for (const f of files) {
            try { size += fs.statSync(path.join(fullPath, f)).size; } catch (_) {}
          }
        } catch (_) {}
        return { name: e.name, fullPath, mtime, size };
      })
      .sort((a, b) => a.mtime - b.mtime);

    for (const dir of sessionDirs) {
      const ageMs = now - dir.mtime;
      const shouldPrune = (ageMs > TWO_HOURS_MS) || (isStorageLow && (ageMs > 10 * 60 * 1000));
      if (shouldPrune) {
        try {
          terminateHlsSession(dir.name);
          if (fs.existsSync(dir.fullPath)) {
            fs.rmSync(dir.fullPath, { recursive: true, force: true });
          }
          prunedCount++;
          freedBytes += dir.size;
        } catch (e) {
          console.warn(`[Housekeeper] Failed to remove ${dir.name}:`, e.message);
        }
      }
    }

    if (prunedCount > 0) {
      console.log(`[Housekeeper] Transcode cache pruned: ${prunedCount} directories (${(freedBytes / (1024 * 1024)).toFixed(1)} MB freed). Free storage: ${(freeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`);
    }
  } catch (err) {
    console.warn('[Housekeeper] Housekeeping error:', err.message);
  }

  return { prunedCount, freedBytes };
}

// 6. Backfill chapters for media items that don't have them
async function backfillChapters() {
  try {
    const movies = db.queryAll('SELECT id, file_path, duration_seconds FROM media_items WHERE type = ?', ['movie']);
    for (const mov of movies) {
      const count = db.queryOne('SELECT COUNT(*) as cnt FROM media_chapters WHERE media_id = ?', [mov.id])?.cnt || 0;
      if (count === 0 && mov.file_path && fs.existsSync(mov.file_path)) {
        const info = await analyzeMediaFile(mov.file_path);
        for (const ch of info.chapters || []) {
          db.run(`
            INSERT INTO media_chapters (id, media_id, chapter_index, start_time, end_time, title)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [`ch-${mov.id}-${ch.chapterIndex}`, mov.id, ch.chapterIndex, ch.startTime, ch.endTime, ch.title]);
        }
      }
    }

    const episodes = db.queryAll('SELECT id, file_path, duration_seconds FROM tv_episodes');
    for (const ep of episodes) {
      const count = db.queryOne('SELECT COUNT(*) as cnt FROM media_chapters WHERE media_id = ?', [ep.id])?.cnt || 0;
      if (count === 0 && ep.file_path && fs.existsSync(ep.file_path)) {
        const info = await analyzeMediaFile(ep.file_path);
        for (const ch of info.chapters || []) {
          db.run(`
            INSERT INTO media_chapters (id, media_id, chapter_index, start_time, end_time, title)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [`ch-${ep.id}-${ch.chapterIndex}`, ep.id, ch.chapterIndex, ch.startTime, ch.endTime, ch.title]);
        }
      }
    }
  } catch (err) {
    console.warn('[NovaPlex] Chapter backfill warning:', err.message);
  }
}

// 7. Initialize default libraries and directory watchers
function initializeDefaultLibraries() {
  const existingLibs = db.queryAll('SELECT * FROM libraries');
  if (existingLibs.length === 0) {
    const moviesDir = path.resolve(__dirname, '../../media/movies');
    const showsDir = path.resolve(__dirname, '../../media/shows');

    if (!fs.existsSync(moviesDir)) fs.mkdirSync(moviesDir, { recursive: true });
    if (!fs.existsSync(showsDir)) fs.mkdirSync(showsDir, { recursive: true });

    db.run(
      'INSERT INTO libraries (id, name, type, paths) VALUES (?, ?, ?, ?)',
      ['lib-movies-default', 'Movies', 'movie', JSON.stringify([moviesDir])]
    );

    db.run(
      'INSERT INTO libraries (id, name, type, paths) VALUES (?, ?, ?, ?)',
      ['lib-shows-default', 'TV Shows', 'show', JSON.stringify([showsDir])]
    );

    console.log('[NovaPlex] Initialized default Movies & TV Shows libraries.');
  }

  const allLibs = db.queryAll('SELECT * FROM libraries');
  for (const lib of allLibs) {
    scanner.startWatcher(lib.id);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  // Start housekeeping interval (every 10 minutes)
  setInterval(runTranscodeCacheHousekeeping, 10 * 60 * 1000);

  // Start Gofile Cloud keep-alive interval (every 24 hours) to prevent file expiration
  setInterval(runKeepAliveHeartbeat, 24 * 60 * 60 * 1000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🍎 NovaPlex Apple Liquid Glass Media Server`);
    console.log(`🚀 Core Server running at http://0.0.0.0:${PORT}`);
    console.log(`✨ Features: 4K Ultra HD Transcoding | HDR10+ | SDR Tonemap | ABR`);
    console.log(`☁️ Cloud Storage: Gofile Direct Play & Auto Keep-Alive Active`);
    console.log(`======================================================\n`);
    initializeDefaultLibraries();
    runTranscodeCacheHousekeeping();
    backfillChapters();

    // Check Gofile heartbeat after 15 seconds
    setTimeout(() => {
      runKeepAliveHeartbeat().catch(e => console.warn('[GofileKeepAlive] Boot heartbeat notice:', e.message));
    }, 15000);
  });
}

export default app;
