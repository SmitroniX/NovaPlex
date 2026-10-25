import express from 'express';
import { db } from '../db/database.js';
import {
  getGofileCredentials,
  fetchGofileAccount,
  findAllStrmFiles,
  runKeepAliveHeartbeat,
  createStrmFile
} from '../scanner/gofileSync.js';
import { FileScanner } from '../scanner/fileScanner.js';

const router = express.Router();
const fileScanner = new FileScanner();

/**
 * GET /api/gofile/status
 * Return current Gofile connection info, credentials, and indexed cloud files
 */
router.get('/status', async (req, res) => {
  try {
    const creds = getGofileCredentials();
    const accountRes = await fetchGofileAccount(creds.token);
    const cloudFiles = findAllStrmFiles();

    res.json({
      configured: Boolean(creds.token),
      token: creds.token,
      rootFolder: creds.rootFolder,
      keepAliveEnabled: creds.keepAliveEnabled,
      lastHeartbeat: creds.lastHeartbeat,
      account: accountRes.success ? accountRes.account : null,
      accountError: accountRes.success ? null : accountRes.error,
      cloudFilesCount: cloudFiles.length,
      cloudFiles: cloudFiles.map(f => ({
        fileName: f.fileName,
        filePath: f.filePath,
        url: f.url,
        libraryType: f.libraryType
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve Gofile status', message: err.message });
  }
});

/**
 * POST /api/gofile/heartbeat
 * Trigger keep-alive ping across all cloud streams to reset Gofile inactivity timer
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const result = await runKeepAliveHeartbeat();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to execute heartbeat', message: err.message });
  }
});

/**
 * POST /api/gofile/add-strm
 * Create a new .strm cloud video entry and trigger scan
 */
router.post('/add-strm', async (req, res) => {
  try {
    const { title, year, streamUrl, libraryType = 'movie', filename } = req.body;
    if (!title || !streamUrl) {
      return res.status(400).json({ error: 'title and streamUrl are required' });
    }

    const created = createStrmFile({
      libraryType,
      title,
      year: year ? parseInt(year, 10) : null,
      streamUrl,
      filename
    });

    // Trigger asynchronous scan of library so metadata and poster are fetched immediately
    fileScanner.scanLibrary(created.libraryId).catch(err => {
      console.error('[GofileSync] Background scan failed after adding .strm:', err.message);
    });

    res.json({
      success: true,
      message: `Created cloud stream for "${title}". Library scan initiated.`,
      file: created
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add cloud stream file', message: err.message });
  }
});

/**
 * POST /api/gofile/settings
 * Update Gofile settings in server_settings
 */
router.post('/settings', (req, res) => {
  try {
    const { token, rootFolder, keepAliveEnabled } = req.body;

    db.transaction((trx) => {
      if (token !== undefined) {
        trx.run(`
          INSERT INTO server_settings (key, value) VALUES ('gofile_token', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `, [String(token).trim()]);
      }
      if (rootFolder !== undefined) {
        trx.run(`
          INSERT INTO server_settings (key, value) VALUES ('gofile_root_folder', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `, [String(rootFolder).trim()]);
      }
      if (keepAliveEnabled !== undefined) {
        trx.run(`
          INSERT INTO server_settings (key, value) VALUES ('gofile_keep_alive', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `, [keepAliveEnabled ? 'true' : 'false']);
      }
    });

    res.json({ success: true, message: 'Gofile settings updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update Gofile settings', message: err.message });
  }
});

export default router;
