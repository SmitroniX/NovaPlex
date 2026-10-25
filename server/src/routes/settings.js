import express from 'express';
import { db } from '../db/database.js';

const router = express.Router();

// Get settings as object
router.get('/', (req, res) => {
  try {
    const rows = db.queryAll('SELECT key, value FROM server_settings');
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });

    // Also include stats
    const totalMovies = db.queryOne("SELECT COUNT(*) as c FROM media_items WHERE type = 'movie'")?.c || 0;
    const totalShows = db.queryOne("SELECT COUNT(*) as c FROM media_items WHERE type = 'show'")?.c || 0;
    const totalEpisodes = db.queryOne("SELECT COUNT(*) as c FROM tv_episodes")?.c || 0;
    const totalLibraries = db.queryOne("SELECT COUNT(*) as c FROM libraries")?.c || 0;

    res.json({
      settings,
      stats: {
        totalMovies,
        totalShows,
        totalEpisodes,
        totalLibraries,
        systemStatus: 'Operational 4K HDR10+'
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve settings', message: err.message });
  }
});

// Update settings
router.post('/', (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Settings object is required' });
    }

    db.transaction((trx) => {
      for (const [key, value] of Object.entries(settings)) {
        trx.run(`
          INSERT INTO server_settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `, [key, String(value)]);
      }
    });

    res.json({ success: true, message: 'Settings saved' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings', message: err.message });
  }
});

export default router;
