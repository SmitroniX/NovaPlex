import express from 'express';
import { db } from '../db/database.js';

const router = express.Router();

function getChaptersForMedia(mediaId, durationSeconds = 0, isEpisodic = false) {
  let chapters = db.queryAll('SELECT * FROM media_chapters WHERE media_id = ? ORDER BY chapter_index ASC', [mediaId]);
  
  if (chapters.length === 0 && durationSeconds > 0) {
    if (isEpisodic) {
      if (durationSeconds >= 300) {
        const introEnd = Math.min(135, Math.max(75, durationSeconds * 0.08));
        chapters = [
          { id: 'ch-0', media_id: mediaId, chapter_index: 0, start_time: 0, end_time: 45, title: 'Cold Open' },
          { id: 'ch-1', media_id: mediaId, chapter_index: 1, start_time: 45, end_time: introEnd, title: 'Intro' },
          { id: 'ch-2', media_id: mediaId, chapter_index: 2, start_time: introEnd, end_time: Math.floor(durationSeconds * 0.45), title: 'Part I' },
          { id: 'ch-3', media_id: mediaId, chapter_index: 3, start_time: Math.floor(durationSeconds * 0.45), end_time: Math.floor(durationSeconds * 0.8), title: 'Part II' },
          { id: 'ch-4', media_id: mediaId, chapter_index: 4, start_time: Math.floor(durationSeconds * 0.8), end_time: Math.max(durationSeconds - 90, Math.floor(durationSeconds * 0.92)), title: 'Climax' },
          { id: 'ch-5', media_id: mediaId, chapter_index: 5, start_time: Math.max(durationSeconds - 90, Math.floor(durationSeconds * 0.92)), end_time: durationSeconds, title: 'Credits' }
        ];
      } else if (durationSeconds >= 15) {
        const p1 = Math.min(4, durationSeconds * 0.2);
        const p2 = Math.min(12, durationSeconds * 0.6);
        const p3 = Math.max(durationSeconds - 4, durationSeconds * 0.85);
        chapters = [
          { id: 'ch-0', media_id: mediaId, chapter_index: 0, start_time: 0, end_time: p1, title: 'Intro' },
          { id: 'ch-1', media_id: mediaId, chapter_index: 1, start_time: p1, end_time: p2, title: 'Part I' },
          { id: 'ch-2', media_id: mediaId, chapter_index: 2, start_time: p2, end_time: p3, title: 'Part II' },
          { id: 'ch-3', media_id: mediaId, chapter_index: 3, start_time: p3, end_time: durationSeconds, title: 'Credits' }
        ];
      }
    } else {
      if (durationSeconds >= 300) {
        const p1 = Math.floor(durationSeconds * 0.2);
        const p2 = Math.floor(durationSeconds * 0.5);
        const p3 = Math.floor(durationSeconds * 0.8);
        const p4 = Math.max(durationSeconds - 120, Math.floor(durationSeconds * 0.92));
        chapters = [
          { id: 'ch-0', media_id: mediaId, chapter_index: 0, start_time: 0, end_time: p1, title: 'Prologue' },
          { id: 'ch-1', media_id: mediaId, chapter_index: 1, start_time: p1, end_time: p2, title: 'Act I' },
          { id: 'ch-2', media_id: mediaId, chapter_index: 2, start_time: p2, end_time: p3, title: 'Act II' },
          { id: 'ch-3', media_id: mediaId, chapter_index: 3, start_time: p3, end_time: p4, title: 'Climax' },
          { id: 'ch-4', media_id: mediaId, chapter_index: 4, start_time: p4, end_time: durationSeconds, title: 'Credits' }
        ];
      }
    }
  }

  const normalizedChapters = chapters.map(c => ({
    ...c,
    startTime: c.start_time ?? c.startTime ?? 0,
    endTime: c.end_time ?? c.endTime ?? 0,
    start_time: c.start_time ?? c.startTime ?? 0,
    end_time: c.end_time ?? c.endTime ?? 0
  }));

  // Detect intro range from explicit intro chapters, or standard fallback offset for episodic content (TV shows)
  let introRange = null;
  const introChapter = normalizedChapters.find(c => {
    const isIntroTitle = /\b(intro|opening|theme|recap)\b/i.test(c.title) && !/^introduction$/i.test(c.title.trim());
    const length = (c.end_time || 0) - (c.start_time || 0);
    return isIntroTitle && length > 0 && length <= 300;
  });

  if (introChapter) {
    introRange = { start: introChapter.start_time, end: introChapter.end_time };
  } else if (isEpisodic) {
    if (durationSeconds >= 300) {
      introRange = { start: 45, end: 135 };
    } else if (durationSeconds >= 20) {
      introRange = { start: 2, end: 6 };
    }
  }

  return { chapters: normalizedChapters, introRange };
}

// 1. List media with filtering, search, sorting, and user-specific watchlist/favorites
router.get('/', (req, res) => {
  try {
    const {
      libraryId, type, genre, resolution, hdr, search, sort,
      userId, filter, favorite, watchlist,
      limit = 50, offset = 0
    } = req.query;

    let sql = 'SELECT * FROM media_items WHERE 1=1';
    const params = [];

    if (libraryId) {
      sql += ' AND library_id = ?';
      params.push(libraryId);
    }

    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }

    if (resolution) {
      sql += ' AND resolution = ?';
      params.push(resolution);
    }

    if (hdr) {
      sql += ' AND hdr_format = ?';
      params.push(hdr);
    }

    if (genre && genre !== 'All') {
      sql += ' AND genres LIKE ?';
      params.push(`%${genre}%`);
    }

    if (search && search.trim()) {
      sql += ' AND (title LIKE ? OR overview LIKE ? OR director LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    // Filter by favorites or watchlist
    if (filter === 'favorites' || favorite === 'true') {
      if (userId) {
        sql += ' AND id IN (SELECT media_id FROM favorites WHERE user_id = ?)';
        params.push(userId);
      } else {
        sql += ' AND 1 = 0';
      }
    } else if (filter === 'watchlist' || watchlist === 'true') {
      if (userId) {
        sql += ' AND id IN (SELECT media_id FROM watchlist WHERE user_id = ?)';
        params.push(userId);
      } else {
        sql += ' AND 1 = 0';
      }
    }

    // Sort order
    if (sort === 'rating') {
      sql += ' ORDER BY rating DESC, release_year DESC';
    } else if (sort === 'year') {
      sql += ' ORDER BY release_year DESC';
    } else if (sort === 'title') {
      sql += ' ORDER BY title ASC';
    } else {
      sql += ' ORDER BY created_at DESC';
    }

    sql += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    let userFavorites = new Set();
    let userWatchlist = new Set();
    if (userId) {
      const faves = db.queryAll('SELECT media_id FROM favorites WHERE user_id = ?', [userId]);
      const watch = db.queryAll('SELECT media_id FROM watchlist WHERE user_id = ?', [userId]);
      userFavorites = new Set(faves.map(r => r.media_id));
      userWatchlist = new Set(watch.map(r => r.media_id));
    }

    const items = db.queryAll(sql, params).map(item => ({
      ...item,
      genres: JSON.parse(item.genres || '[]'),
      cast: JSON.parse(item.cast_json || '[]'),
      is_favorite: userFavorites.has(item.id),
      in_watchlist: userWatchlist.has(item.id)
    }));

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch media catalog', message: err.message });
  }
});

// 2. User Watchlist Endpoints
router.get('/user/watchlist', (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const items = db.queryAll(`
      SELECT m.*, w.added_at as watchlist_added_at
      FROM media_items m
      JOIN watchlist w ON m.id = w.media_id
      WHERE w.user_id = ?
      ORDER BY w.added_at DESC
    `, [userId]).map(item => ({
      ...item,
      genres: JSON.parse(item.genres || '[]'),
      cast: JSON.parse(item.cast_json || '[]'),
      in_watchlist: true
    }));

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch watchlist', message: err.message });
  }
});

router.post('/user/watchlist', (req, res) => {
  try {
    const { userId, mediaId } = req.body;
    if (!userId || !mediaId) return res.status(400).json({ error: 'userId and mediaId are required' });

    const existing = db.queryOne('SELECT * FROM watchlist WHERE user_id = ? AND media_id = ?', [userId, mediaId]);
    if (existing) {
      db.run('DELETE FROM watchlist WHERE user_id = ? AND media_id = ?', [userId, mediaId]);
      return res.json({ success: true, inWatchlist: false });
    } else {
      db.run('INSERT INTO watchlist (user_id, media_id) VALUES (?, ?)', [userId, mediaId]);
      return res.json({ success: true, inWatchlist: true });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to update watchlist', message: err.message });
  }
});

router.delete('/user/watchlist/:mediaId', (req, res) => {
  try {
    const { userId } = req.query;
    const { mediaId } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    db.run('DELETE FROM watchlist WHERE user_id = ? AND media_id = ?', [userId, mediaId]);
    res.json({ success: true, inWatchlist: false });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove from watchlist', message: err.message });
  }
});

// 3. User Favorites Endpoints
router.get('/user/favorites', (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const items = db.queryAll(`
      SELECT m.*, f.added_at as favorite_added_at
      FROM media_items m
      JOIN favorites f ON m.id = f.media_id
      WHERE f.user_id = ?
      ORDER BY f.added_at DESC
    `, [userId]).map(item => ({
      ...item,
      genres: JSON.parse(item.genres || '[]'),
      cast: JSON.parse(item.cast_json || '[]'),
      is_favorite: true
    }));

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch favorites', message: err.message });
  }
});

router.post('/user/favorites', (req, res) => {
  try {
    const { userId, mediaId } = req.body;
    if (!userId || !mediaId) return res.status(400).json({ error: 'userId and mediaId are required' });

    const existing = db.queryOne('SELECT * FROM favorites WHERE user_id = ? AND media_id = ?', [userId, mediaId]);
    if (existing) {
      db.run('DELETE FROM favorites WHERE user_id = ? AND media_id = ?', [userId, mediaId]);
      return res.json({ success: true, isFavorite: false });
    } else {
      db.run('INSERT INTO favorites (user_id, media_id) VALUES (?, ?)', [userId, mediaId]);
      return res.json({ success: true, isFavorite: true });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to update favorites', message: err.message });
  }
});

router.delete('/user/favorites/:mediaId', (req, res) => {
  try {
    const { userId } = req.query;
    const { mediaId } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    db.run('DELETE FROM favorites WHERE user_id = ? AND media_id = ?', [userId, mediaId]);
    res.json({ success: true, isFavorite: false });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove from favorites', message: err.message });
  }
});

// 4. Dedicated Chapters & Intro Range endpoint
router.get('/:id/chapters', (req, res) => {
  try {
    const { id } = req.params;
    let dur = 0;
    let isEpisodic = false;
    const movie = db.queryOne('SELECT duration_seconds, type FROM media_items WHERE id = ?', [id]);
    if (movie) {
      dur = movie.duration_seconds || 0;
      isEpisodic = movie.type === 'show';
    } else {
      const ep = db.queryOne('SELECT duration_seconds FROM tv_episodes WHERE id = ?', [id]);
      if (ep) {
        dur = ep.duration_seconds || 0;
        isEpisodic = true;
      }
    }

    const { chapters, introRange } = getChaptersForMedia(id, dur, isEpisodic);
    res.json({ chapters, introRange });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chapters', message: err.message });
  }
});

// 5. Get single media item details (Movie or Show)
router.get('/:id', (req, res) => {
  try {
    const { userId } = req.query;
    let item = db.queryOne('SELECT * FROM media_items WHERE id = ?', [req.params.id]);
    if (!item) {
      const ep = db.queryOne('SELECT * FROM tv_episodes WHERE id = ?', [req.params.id]);
      if (ep) {
        const show = db.queryOne('SELECT title, poster_url, backdrop_url, resolution, hdr_format FROM media_items WHERE id = ?', [ep.show_id]);
        const streams = db.queryAll('SELECT * FROM media_streams WHERE media_id = ? ORDER BY stream_index ASC', [ep.id]);
        const { chapters, introRange } = getChaptersForMedia(ep.id, Number(ep.duration_seconds || 0), true);

        let isFavorite = false;
        let inWatchlist = false;
        if (userId) {
          isFavorite = Boolean(db.queryOne('SELECT 1 FROM favorites WHERE user_id = ? AND media_id = ?', [userId, ep.show_id]));
          inWatchlist = Boolean(db.queryOne('SELECT 1 FROM watchlist WHERE user_id = ? AND media_id = ?', [userId, ep.show_id]));
        }

        return res.json({
          id: ep.id,
          mediaId: ep.show_id,
          episodeId: ep.id,
          type: 'show',
          title: ep.title,
          showTitle: show?.title || 'Show',
          seasonNumber: 1,
          episodeNumber: ep.episode_number,
          resolution: ep.resolution || show?.resolution || '1080p FHD',
          hdrFormat: ep.hdr_format || show?.hdr_format || 'HDR10+',
          duration_seconds: Number(ep.duration_seconds || 0),
          duration: Number(ep.duration_seconds || 0),
          backdrop_url: ep.still_url || show?.backdrop_url,
          poster_url: show?.poster_url,
          streams,
          chapters,
          introRange,
          is_favorite: isFavorite,
          in_watchlist: inWatchlist
        });
      }
      return res.status(404).json({ error: 'Media not found' });
    }

    const genres = JSON.parse(item.genres || '[]');
    const cast = JSON.parse(item.cast_json || '[]');
    const streams = db.queryAll('SELECT * FROM media_streams WHERE media_id = ? ORDER BY stream_index ASC', [item.id]);
    const isEpisodic = item.type === 'show';
    const { chapters, introRange } = getChaptersForMedia(item.id, Number(item.duration_seconds || 0), isEpisodic);

    let isFavorite = false;
    let inWatchlist = false;
    if (userId) {
      isFavorite = Boolean(db.queryOne('SELECT 1 FROM favorites WHERE user_id = ? AND media_id = ?', [userId, item.id]));
      inWatchlist = Boolean(db.queryOne('SELECT 1 FROM watchlist WHERE user_id = ? AND media_id = ?', [userId, item.id]));
    }

    let seasons = [];
    if (item.type === 'show') {
      const dbSeasons = db.queryAll('SELECT * FROM tv_seasons WHERE show_id = ? ORDER BY season_number ASC', [item.id]);
      seasons = dbSeasons.map(s => {
        const episodes = db.queryAll('SELECT * FROM tv_episodes WHERE season_id = ? ORDER BY episode_number ASC', [s.id]);
        return {
          ...s,
          episodes
        };
      });
    }

    res.json({
      ...item,
      genres,
      cast,
      streams,
      seasons,
      chapters,
      introRange,
      is_favorite: isFavorite,
      in_watchlist: inWatchlist
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve media item', message: err.message });
  }
});

// 6. Get single episode details with its streams & chapters
router.get('/episodes/:id', (req, res) => {
  try {
    const { userId } = req.query;
    const episode = db.queryOne('SELECT * FROM tv_episodes WHERE id = ?', [req.params.id]);
    if (!episode) return res.status(404).json({ error: 'Episode not found' });

    const show = db.queryOne('SELECT title, poster_url, backdrop_url FROM media_items WHERE id = ?', [episode.show_id]);
    const streams = db.queryAll('SELECT * FROM media_streams WHERE media_id = ? ORDER BY stream_index ASC', [episode.id]);
    const { chapters, introRange } = getChaptersForMedia(episode.id, Number(episode.duration_seconds || 0), true);

    let isFavorite = false;
    let inWatchlist = false;
    if (userId) {
      isFavorite = Boolean(db.queryOne('SELECT 1 FROM favorites WHERE user_id = ? AND media_id = ?', [userId, episode.show_id]));
      inWatchlist = Boolean(db.queryOne('SELECT 1 FROM watchlist WHERE user_id = ? AND media_id = ?', [userId, episode.show_id]));
    }

    res.json({
      ...episode,
      showTitle: show?.title || 'Show',
      showPoster: show?.poster_url,
      showBackdrop: show?.backdrop_url,
      streams,
      chapters,
      introRange,
      is_favorite: isFavorite,
      in_watchlist: inWatchlist
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve episode', message: err.message });
  }
});

export default router;
