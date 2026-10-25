-- NovaPlex Database Schema (node:sqlite)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS libraries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('movie', 'show')),
  paths TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_items (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('movie', 'show')),
  title TEXT NOT NULL,
  original_title TEXT,
  release_year INTEGER,
  duration_seconds REAL DEFAULT 0,
  overview TEXT,
  rating REAL DEFAULT 0,
  content_rating TEXT DEFAULT 'NR',
  poster_url TEXT,
  backdrop_url TEXT,
  genres TEXT DEFAULT '[]',
  director TEXT,
  cast_json TEXT DEFAULT '[]',
  file_path TEXT UNIQUE,
  file_size INTEGER DEFAULT 0,
  container TEXT,
  video_codec TEXT,
  resolution TEXT DEFAULT '1080p FHD',
  width INTEGER DEFAULT 1920,
  height INTEGER DEFAULT 1080,
  color_space TEXT,
  color_transfer TEXT,
  color_primaries TEXT,
  pix_fmt TEXT,
  bit_depth INTEGER DEFAULT 8,
  hdr_format TEXT DEFAULT 'SDR',
  audio_codec TEXT,
  audio_channels INTEGER DEFAULT 2,
  tmdb_id INTEGER,
  imdb_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tv_seasons (
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  title TEXT,
  overview TEXT,
  poster_url TEXT,
  episode_count INTEGER DEFAULT 0,
  UNIQUE(show_id, season_number)
);

CREATE TABLE IF NOT EXISTS tv_episodes (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES tv_seasons(id) ON DELETE CASCADE,
  show_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  overview TEXT,
  still_url TEXT,
  duration_seconds REAL DEFAULT 0,
  file_path TEXT UNIQUE,
  file_size INTEGER DEFAULT 0,
  container TEXT,
  video_codec TEXT,
  resolution TEXT DEFAULT '1080p FHD',
  width INTEGER DEFAULT 1920,
  height INTEGER DEFAULT 1080,
  color_space TEXT,
  color_transfer TEXT,
  bit_depth INTEGER DEFAULT 8,
  hdr_format TEXT DEFAULT 'SDR',
  audio_codec TEXT,
  audio_channels INTEGER DEFAULT 2,
  UNIQUE(season_id, episode_number)
);

CREATE TABLE IF NOT EXISTS media_streams (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  stream_type TEXT NOT NULL CHECK(stream_type IN ('video', 'audio', 'subtitle')),
  stream_index INTEGER NOT NULL,
  codec TEXT,
  language TEXT DEFAULT 'und',
  title TEXT,
  channels INTEGER,
  channel_layout TEXT,
  is_default INTEGER DEFAULT 0,
  is_forced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  pin TEXT,
  is_admin INTEGER DEFAULT 0,
  avatar TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playback_state (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  position_seconds REAL NOT NULL DEFAULT 0,
  duration_seconds REAL NOT NULL DEFAULT 0,
  completed INTEGER DEFAULT 0,
  last_watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, media_id)
);

CREATE TABLE IF NOT EXISTS server_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_chapters (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  chapter_index INTEGER NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, media_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, media_id)
);

-- Performance indices
CREATE INDEX IF NOT EXISTS idx_media_library ON media_items(library_id);
CREATE INDEX IF NOT EXISTS idx_media_type ON media_items(type);
CREATE INDEX IF NOT EXISTS idx_media_title ON media_items(title);
CREATE INDEX IF NOT EXISTS idx_episodes_show ON tv_episodes(show_id);
CREATE INDEX IF NOT EXISTS idx_episodes_season ON tv_episodes(season_id);
CREATE INDEX IF NOT EXISTS idx_streams_media ON media_streams(media_id);
CREATE INDEX IF NOT EXISTS idx_playback_user ON playback_state(user_id);
CREATE INDEX IF NOT EXISTS idx_chapters_media ON media_chapters(media_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);

