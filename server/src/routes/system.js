import express from 'express';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/database.js';
import { scanner } from '../scanner/fileScanner.js';
import {
  getActiveHlsSessions,
  terminateHlsSession,
  terminateAllHlsSessions,
  cleanTranscodeCache
} from '../stream/hlsTranscoder.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to calculate total directory size in bytes recursively
function getDirectorySize(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) return stats.size;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirectorySize(full);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch (_) {}
      }
    }
  } catch (_) {}
  return total;
}

// 1. Comprehensive System Dashboard Metrics
router.get('/dashboard', (req, res) => {
  try {
    const now = Date.now();
    const uptimeSec = Math.floor(process.uptime());

    // Storage computations
    const moviesDir = path.resolve(__dirname, '../../../media/movies');
    const showsDir = path.resolve(__dirname, '../../../media/shows');
    const transcodeDir = path.resolve(__dirname, '../../data/transcode');
    const imageCacheDir = path.resolve(__dirname, '../../data/cache/images');
    const dbPath = path.resolve(__dirname, '../../data/novaplex.db');

    const moviesSize = getDirectorySize(moviesDir);
    const showsSize = getDirectorySize(showsDir);
    const transcodeSize = getDirectorySize(transcodeDir);
    const imageCacheSize = getDirectorySize(imageCacheDir);
    let dbSize = 0;
    try {
      if (fs.existsSync(dbPath)) dbSize = fs.statSync(dbPath).size;
    } catch (_) {}

    // Active transcode sessions enriched with media titles
    const rawSessions = getActiveHlsSessions();
    const activeSessions = rawSessions.map(sess => {
      let title = 'Direct / Unknown Stream';
      if (sess.mediaId) {
        const ep = db.queryOne('SELECT title, show_id, episode_number FROM tv_episodes WHERE id = ?', [sess.mediaId]);
        if (ep) {
          const show = db.queryOne('SELECT title FROM media_items WHERE id = ?', [ep.show_id]);
          title = `${show?.title || 'Series'} S1:E${ep.episode_number} - ${ep.title}`;
        } else {
          const mov = db.queryOne('SELECT title FROM media_items WHERE id = ?', [sess.mediaId]);
          if (mov) title = mov.title;
        }
      }
      return {
        ...sess,
        mediaTitle: title
      };
    });

    // Counts
    const totalMovies = db.queryOne("SELECT COUNT(*) as c FROM media_items WHERE type = 'movie'")?.c || 0;
    const totalShows = db.queryOne("SELECT COUNT(*) as c FROM media_items WHERE type = 'show'")?.c || 0;
    const totalEpisodes = db.queryOne("SELECT COUNT(*) as c FROM tv_episodes")?.c || 0;
    const totalLibraries = db.queryOne("SELECT COUNT(*) as c FROM libraries")?.c || 0;
    const totalUsers = db.queryOne("SELECT COUNT(*) as c FROM users")?.c || 0;

    // Recent playback history (last 5 records)
    const recentPlayback = db.queryAll(`
      SELECT p.media_id, p.position_seconds, p.duration_seconds, p.completed, p.last_watched_at,
             u.username, u.avatar
      FROM playback_state p
      LEFT JOIN users u ON p.user_id = u.id
      ORDER BY p.last_watched_at DESC
      LIMIT 5
    `).map(rec => {
      let title = 'Media Stream';
      const ep = db.queryOne('SELECT title, show_id, episode_number FROM tv_episodes WHERE id = ?', [rec.media_id]);
      if (ep) {
        const show = db.queryOne('SELECT title FROM media_items WHERE id = ?', [ep.show_id]);
        title = `${show?.title || 'Series'} S1:E${ep.episode_number} - ${ep.title}`;
      } else {
        const mov = db.queryOne('SELECT title FROM media_items WHERE id = ?', [rec.media_id]);
        if (mov) title = mov.title;
      }
      return {
        ...rec,
        title
      };
    });

    res.json({
      health: {
        status: 'online',
        server: 'NovaPlex Apple Liquid Glass Media Server',
        version: '1.0.0',
        uptimeSeconds: uptimeSec,
        uptimeFormatted: `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m ${uptimeSec % 60}s`,
        timestamp: new Date().toISOString()
      },
      hardware: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        cpuModel: os.cpus()[0]?.model || 'Host Processor',
        cpuCores: os.cpus().length,
        loadAvg: os.loadavg().map(l => parseFloat(l.toFixed(2)))
      },
      memory: {
        totalBytes: os.totalmem(),
        freeBytes: os.freemem(),
        usedBytes: os.totalmem() - os.freemem(),
        percentUsed: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
        processRssBytes: process.memoryUsage().rss,
        processHeapUsedBytes: process.memoryUsage().heapUsed,
        processHeapTotalBytes: process.memoryUsage().heapTotal
      },
      storage: {
        moviesBytes: moviesSize,
        showsBytes: showsSize,
        transcodeBytes: transcodeSize,
        imageCacheBytes: imageCacheSize,
        dbBytes: dbSize,
        totalBytes: moviesSize + showsSize + transcodeSize + imageCacheSize + dbSize
      },
      transcode: {
        activeSessions,
        activeCount: activeSessions.length,
        capabilities: {
          ultraHD4K: true,
          hdr10Plus: true,
          sdrTonemap: true,
          directPlay: true,
          remux: true,
          hardwareAcceleration: 'Apple VideoToolbox / FFmpeg VAAPI auto-detect'
        }
      },
      catalog: {
        totalMovies,
        totalShows,
        totalEpisodes,
        totalLibraries,
        totalUsers,
        recentPlayback
      }
    });
  } catch (err) {
    console.error('[SystemRoute] Dashboard metrics error:', err);
    res.status(500).json({ error: 'Failed to fetch system metrics', message: err.message });
  }
});

// 2. Quick Action: Scan All Libraries
router.post('/scan-all', async (req, res) => {
  try {
    const libs = db.queryAll('SELECT id, name FROM libraries');
    const started = [];
    for (const lib of libs) {
      scanner.scanLibrary(lib.id).catch(err => {
        console.warn(`[SystemRoute] Error scanning library ${lib.name}:`, err);
      });
      started.push(lib.name);
    }
    res.json({ success: true, message: `Scan initiated for ${started.length} libraries`, libraries: started });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start library scans', message: err.message });
  }
});

// 3. Quick Action: Clean Transcode Cache
router.post('/clean-transcode', (req, res) => {
  try {
    const freedCount = cleanTranscodeCache();
    res.json({ success: true, message: `Cleaned ${freedCount} transcode cache folders` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clean transcode cache', message: err.message });
  }
});

// 4. Quick Action: Terminate Single Transcode Session
router.post('/terminate-session', (req, res) => {
  try {
    const { sessionKey } = req.body;
    if (!sessionKey) {
      return res.status(400).json({ error: 'sessionKey is required' });
    }
    const terminated = terminateHlsSession(sessionKey);
    res.json({ success: terminated, sessionKey, message: terminated ? 'Session terminated' : 'Session not found or already ended' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to terminate session', message: err.message });
  }
});

// 5. Quick Action: Restart Stream Engine (terminate all sessions and clear cache)
router.post('/restart-stream-engine', (req, res) => {
  try {
    const count = terminateAllHlsSessions();
    cleanTranscodeCache();
    res.json({ success: true, message: `Streaming engine reset. Terminated ${count} active sessions.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restart stream engine', message: err.message });
  }
});

export default router;
