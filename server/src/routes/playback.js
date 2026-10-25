import express from 'express';
import { db } from '../db/database.js';

const router = express.Router();

// Get Continue Watching / On Deck for user
router.get('/continue', (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    // Fetch items with unfinished playback (position > 10s and not completed)
    const records = db.queryAll(`
      SELECT * FROM playback_state
      WHERE user_id = ? AND completed = 0 AND position_seconds > 10
      ORDER BY last_watched_at DESC
      LIMIT 15
    `, [userId]);

    const results = [];
    for (const record of records) {
      // 1. Check if media_id is an episode
      const episode = db.queryOne('SELECT * FROM tv_episodes WHERE id = ?', [record.media_id]);
      if (episode) {
        const show = db.queryOne('SELECT * FROM media_items WHERE id = ?', [episode.show_id]);
        const season = db.queryOne('SELECT season_number FROM tv_seasons WHERE id = ?', [episode.season_id]);

        results.push({
          mediaId: show?.id || episode.show_id,
          episodeId: episode.id,
          type: 'show',
          title: show?.title || 'TV Series',
          episodeTitle: episode.title,
          seasonNumber: season?.season_number || 1,
          episodeNumber: episode.episode_number,
          posterUrl: show?.poster_url,
          backdropUrl: episode.still_url || show?.backdrop_url,
          resolution: episode.resolution,
          hdrFormat: episode.hdr_format,
          positionSeconds: record.position_seconds,
          durationSeconds: record.duration_seconds || episode.duration_seconds,
          percent: record.duration_seconds > 0 ? Math.min(100, Math.round((record.position_seconds / record.duration_seconds) * 100)) : 0,
          lastWatchedAt: record.last_watched_at
        });
        continue;
      }

      // 2. Check movie
      const movie = db.queryOne('SELECT * FROM media_items WHERE id = ?', [record.media_id]);
      if (movie) {
        results.push({
          mediaId: movie.id,
          type: 'movie',
          title: movie.title,
          releaseYear: movie.release_year,
          posterUrl: movie.poster_url,
          backdropUrl: movie.backdrop_url,
          resolution: movie.resolution,
          hdrFormat: movie.hdr_format,
          positionSeconds: record.position_seconds,
          durationSeconds: record.duration_seconds || movie.duration_seconds,
          percent: record.duration_seconds > 0 ? Math.min(100, Math.round((record.position_seconds / record.duration_seconds) * 100)) : 0,
          lastWatchedAt: record.last_watched_at
        });
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch continue watching', message: err.message });
  }
});

// Update playback progress (heartbeat sent every 5s from player)
router.post('/progress', (req, res) => {
  try {
    const { userId, mediaId, positionSeconds, durationSeconds, completed = false } = req.body;
    if (!userId || !mediaId) {
      return res.status(400).json({ error: 'userId and mediaId are required' });
    }

    const pos = parseFloat(positionSeconds) || 0;
    const dur = parseFloat(durationSeconds) || 0;
    const isDone = completed || (dur > 0 && pos / dur > 0.92) ? 1 : 0;

    db.run(`
      INSERT INTO playback_state (user_id, media_id, position_seconds, duration_seconds, completed, last_watched_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, media_id) DO UPDATE SET
        position_seconds = excluded.position_seconds,
        duration_seconds = excluded.duration_seconds,
        completed = excluded.completed,
        last_watched_at = CURRENT_TIMESTAMP
    `, [userId, mediaId, pos, dur, isDone]);

    res.json({ success: true, positionSeconds: pos, completed: Boolean(isDone) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record playback progress', message: err.message });
  }
});

// Mark watched/unwatched
router.post('/mark', (req, res) => {
  try {
    const { userId, mediaId, completed } = req.body;
    if (!userId || !mediaId) return res.status(400).json({ error: 'Missing parameters' });

    const isDone = completed ? 1 : 0;
    db.run(`
      INSERT INTO playback_state (user_id, media_id, position_seconds, duration_seconds, completed, last_watched_at)
      VALUES (?, ?, 0, 0, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, media_id) DO UPDATE SET
        completed = excluded.completed,
        last_watched_at = CURRENT_TIMESTAMP
    `, [userId, mediaId, isDone]);

    res.json({ success: true, completed: Boolean(isDone) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark playback', message: err.message });
  }
});

export default router;
