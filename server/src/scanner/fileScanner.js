import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import chokidar from 'chokidar';
import { db } from '../db/database.js';
import { parseMovieFilename, parseEpisodeFilename } from './nameParser.js';
import { analyzeMediaFile } from './ffprobeAnalyzer.js';
import { fetchMovieMetadata, fetchShowMetadata } from '../metadata/metadataFetcher.js';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.ts', '.m4v', '.strm']);

function isVideoFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

function generateId(prefix = 'item') {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

export class FileScanner {
  constructor() {
    this.watchers = new Map();
    this.isScanning = false;
  }

  /**
   * Recursively find all video files in directory
   */
  async crawlDirectory(dirPath) {
    const results = [];
    if (!fs.existsSync(dirPath)) return results;

    const traverse = async (currentDir) => {
      try {
        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
              await traverse(fullPath);
            }
          } else if (entry.isFile() && isVideoFile(entry.name)) {
            results.push(fullPath);
          }
        }
      } catch (err) {
        console.warn(`[FileScanner] Error reading directory ${currentDir}:`, err.message);
      }
    };

    await traverse(dirPath);
    return results;
  }

  /**
   * Scan an entire library by ID
   */
  async scanLibrary(libraryId) {
    const library = db.queryOne('SELECT * FROM libraries WHERE id = ?', [libraryId]);
    if (!library) throw new Error(`Library ${libraryId} not found`);

    const paths = JSON.parse(library.paths || '[]');
    console.log(`[FileScanner] Starting scan for library "${library.name}" (${library.type}) across ${paths.length} path(s)...`);

    const tmdbApiKey = db.queryOne("SELECT value FROM server_settings WHERE key = 'tmdb_api_key'")?.value || '';

    let addedCount = 0;
    let updatedCount = 0;

    for (const folderPath of paths) {
      if (!fs.existsSync(folderPath)) {
        console.warn(`[FileScanner] Path does not exist: ${folderPath}`);
        continue;
      }

      const videoFiles = await this.crawlDirectory(folderPath);
      console.log(`[FileScanner] Found ${videoFiles.length} video files in ${folderPath}`);

      if (library.type === 'movie') {
        for (const filePath of videoFiles) {
          try {
            const existing = db.queryOne('SELECT id, duration_seconds FROM media_items WHERE file_path = ?', [filePath]);
            if (existing && existing.duration_seconds && existing.duration_seconds > 0) continue;

            const parsed = parseMovieFilename(filePath);
            const mediaInfo = await analyzeMediaFile(filePath);
            const metadata = await fetchMovieMetadata(parsed.title, parsed.year, tmdbApiKey);

            const mediaId = existing?.id || generateId('mov');

            db.transaction((trx) => {
              if (existing) {
                trx.run(`
                  UPDATE media_items SET
                    duration_seconds = ?, file_size = ?, container = ?, video_codec = ?,
                    resolution = ?, width = ?, height = ?, color_space = ?, color_transfer = ?,
                    color_primaries = ?, pix_fmt = ?, bit_depth = ?, hdr_format = ?,
                    audio_codec = ?, audio_channels = ?, updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?
                `, [
                  mediaInfo.durationSeconds, mediaInfo.fileSize, mediaInfo.container, mediaInfo.videoCodec,
                  mediaInfo.resolution, mediaInfo.width, mediaInfo.height, mediaInfo.colorSpace, mediaInfo.colorTransfer,
                  mediaInfo.colorPrimaries, mediaInfo.pixFmt, mediaInfo.bitDepth, mediaInfo.hdrFormat,
                  mediaInfo.audioCodec, mediaInfo.audioChannels, mediaId
                ]);
                trx.run('DELETE FROM media_streams WHERE media_id = ?', [mediaId]);
                trx.run('DELETE FROM media_chapters WHERE media_id = ?', [mediaId]);
                updatedCount++;
              } else {
                trx.run(`
                  INSERT INTO media_items (
                    id, library_id, type, title, original_title, release_year, duration_seconds,
                    overview, rating, content_rating, poster_url, backdrop_url, genres, director,
                    cast_json, file_path, file_size, container, video_codec, resolution, width, height,
                    color_space, color_transfer, color_primaries, pix_fmt, bit_depth, hdr_format,
                    audio_codec, audio_channels, tmdb_id, imdb_id
                  ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?
                  )
                `, [
                  mediaId,
                  libraryId,
                  'movie',
                  metadata.title || parsed.title,
                  metadata.originalTitle || parsed.title,
                  metadata.releaseYear || parsed.year || 2024,
                  mediaInfo.durationSeconds,
                  metadata.overview,
                  metadata.rating,
                  metadata.contentRating,
                  metadata.posterUrl,
                  metadata.backdropUrl,
                  JSON.stringify(metadata.genres || []),
                  metadata.director,
                  JSON.stringify(metadata.cast || []),
                  filePath,
                  mediaInfo.fileSize,
                  mediaInfo.container,
                  mediaInfo.videoCodec,
                  mediaInfo.resolution,
                  mediaInfo.width,
                  mediaInfo.height,
                  mediaInfo.colorSpace,
                  mediaInfo.colorTransfer,
                  mediaInfo.colorPrimaries,
                  mediaInfo.pixFmt,
                  mediaInfo.bitDepth,
                  mediaInfo.hdrFormat,
                  mediaInfo.audioCodec,
                  mediaInfo.audioChannels,
                  metadata.tmdbId || null,
                  metadata.imdbId || null
                ]);
                addedCount++;
              }

              // Insert audio streams
              for (const aud of mediaInfo.audioStreams) {
                trx.run(`
                  INSERT INTO media_streams (id, media_id, stream_type, stream_index, codec, language, title, channels, channel_layout, is_default)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [generateId('str'), mediaId, 'audio', aud.streamIndex, aud.codec, aud.language, aud.title, aud.channels, aud.channelLayout, aud.isDefault]);
              }

              // Insert subtitle streams
              for (const sub of mediaInfo.subtitleStreams) {
                trx.run(`
                  INSERT INTO media_streams (id, media_id, stream_type, stream_index, codec, language, title, is_default, is_forced)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [generateId('str'), mediaId, 'subtitle', sub.streamIndex, sub.codec, sub.language, sub.title, sub.isDefault, sub.isForced]);
              }

              // Insert chapters
              for (const ch of mediaInfo.chapters || []) {
                trx.run(`
                  INSERT INTO media_chapters (id, media_id, chapter_index, start_time, end_time, title)
                  VALUES (?, ?, ?, ?, ?, ?)
                `, [generateId('chap'), mediaId, ch.chapterIndex, ch.startTime, ch.endTime, ch.title]);
              }
            });

            addedCount++;
            console.log(`[FileScanner] Indexed Movie: "${metadata.title}" [${mediaInfo.resolution} | ${mediaInfo.hdrFormat}]`);
          } catch (err) {
            console.error(`[FileScanner] Error indexing movie ${filePath}:`, err);
          }
        }
      } else if (library.type === 'show') {
        // Group files by show title
        const showGroups = new Map();

        for (const filePath of videoFiles) {
          const epInfo = await analyzeMediaFile(filePath);
          const parsed = parseEpisodeFilename(filePath, epInfo.titleTag);
          if (!showGroups.has(parsed.showTitle)) {
            showGroups.set(parsed.showTitle, []);
          }
          showGroups.get(parsed.showTitle).push({ filePath, parsed, epInfo });
        }

        for (const [showTitle, episodes] of showGroups.entries()) {
          try {
            let show = db.queryOne('SELECT * FROM media_items WHERE library_id = ? AND (title = ? COLLATE NOCASE OR original_title = ? COLLATE NOCASE)', [libraryId, showTitle, showTitle]);
            let showId = show?.id;

            const metadata = await fetchShowMetadata(showTitle, tmdbApiKey);

            if (!show) {
              showId = generateId('show');
              db.run(`
                INSERT INTO media_items (
                  id, library_id, type, title, original_title, release_year, overview, rating,
                  content_rating, poster_url, backdrop_url, genres, director, cast_json,
                  resolution, hdr_format
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `, [
                showId,
                libraryId,
                'show',
                metadata.title || showTitle,
                metadata.originalTitle || showTitle,
                metadata.releaseYear || 2024,
                metadata.overview,
                metadata.rating,
                metadata.contentRating,
                metadata.posterUrl,
                metadata.backdropUrl,
                JSON.stringify(metadata.genres || []),
                metadata.director,
                JSON.stringify(metadata.cast || []),
                '1080p FHD',
                'HDR10+'
              ]);
            }

            // Group into seasons
            const seasonMap = new Map();
            for (const ep of episodes) {
              const sNum = ep.parsed.seasonNumber;
              if (!seasonMap.has(sNum)) seasonMap.set(sNum, []);
              seasonMap.get(sNum).push(ep);
            }

            for (const [seasonNum, seasonEps] of seasonMap.entries()) {
              let season = db.queryOne('SELECT * FROM tv_seasons WHERE show_id = ? AND season_number = ?', [showId, seasonNum]);
              let seasonId = season?.id;

              if (!season) {
                seasonId = generateId('sea');
                db.run(`
                  INSERT INTO tv_seasons (id, show_id, season_number, title, poster_url, episode_count)
                  VALUES (?, ?, ?, ?, ?, ?)
                `, [seasonId, showId, seasonNum, `Season ${seasonNum}`, metadata.posterUrl, seasonEps.length]);
              } else {
                db.run('UPDATE tv_seasons SET episode_count = ? WHERE id = ?', [seasonEps.length, seasonId]);
              }

              for (const item of seasonEps) {
                const epExists = db.queryOne('SELECT id, duration_seconds FROM tv_episodes WHERE file_path = ?', [item.filePath]);
                if (epExists && epExists.duration_seconds && epExists.duration_seconds > 0) continue;

                const epInfo = item.epInfo || await analyzeMediaFile(item.filePath);
                const epKey = `s${seasonNum}e${item.parsed.episodeNumber}`;
                const guide = metadata.episodesGuide?.get(epKey);

                const episodeId = epExists?.id || generateId('ep');
                const epTitle = guide?.title || item.parsed.episodeTitle;
                const epOverview = guide?.overview || `Episode ${item.parsed.episodeNumber} of ${showTitle}.`;
                const epStill = guide?.stillUrl || metadata.backdropUrl;

                db.transaction((trx) => {
                  if (epExists) {
                    trx.run(`
                      UPDATE tv_episodes SET
                        duration_seconds = ?, file_size = ?, container = ?, video_codec = ?,
                        resolution = ?, width = ?, height = ?, color_space = ?, color_transfer = ?,
                        bit_depth = ?, hdr_format = ?, audio_codec = ?, audio_channels = ?
                      WHERE id = ?
                    `, [
                      epInfo.durationSeconds, epInfo.fileSize, epInfo.container, epInfo.videoCodec,
                      epInfo.resolution, epInfo.width, epInfo.height, epInfo.colorSpace, epInfo.colorTransfer,
                      epInfo.bitDepth, epInfo.hdrFormat, epInfo.audioCodec, epInfo.audioChannels, episodeId
                    ]);
                    trx.run('DELETE FROM media_streams WHERE media_id = ?', [episodeId]);
                    updatedCount++;
                  } else {
                    trx.run(`
                      INSERT INTO tv_episodes (
                        id, season_id, show_id, episode_number, title, overview, still_url,
                        duration_seconds, file_path, file_size, container, video_codec,
                        resolution, width, height, color_space, color_transfer, bit_depth,
                        hdr_format, audio_codec, audio_channels
                      ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?,
                        ?, ?, ?
                      )
                    `, [
                      episodeId,
                      seasonId,
                      showId,
                      item.parsed.episodeNumber,
                      epTitle,
                      epOverview,
                      epStill,
                      epInfo.durationSeconds,
                      item.filePath,
                      epInfo.fileSize,
                      epInfo.container,
                      epInfo.videoCodec,
                      epInfo.resolution,
                      epInfo.width,
                      epInfo.height,
                      epInfo.colorSpace,
                      epInfo.colorTransfer,
                      epInfo.bitDepth,
                      epInfo.hdrFormat,
                      epInfo.audioCodec,
                      epInfo.audioChannels
                    ]);
                    addedCount++;
                  }

                  for (const aud of epInfo.audioStreams) {
                    trx.run(`
                      INSERT INTO media_streams (id, media_id, stream_type, stream_index, codec, language, title, channels, channel_layout, is_default)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [generateId('str'), episodeId, 'audio', aud.streamIndex, aud.codec, aud.language, aud.title, aud.channels, aud.channelLayout, aud.isDefault]);
                  }

                  for (const sub of epInfo.subtitleStreams) {
                    trx.run(`
                      INSERT INTO media_streams (id, media_id, stream_type, stream_index, codec, language, title, is_default, is_forced)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [generateId('str'), episodeId, 'subtitle', sub.streamIndex, sub.codec, sub.language, sub.title, sub.isDefault, sub.isForced]);
                  }

                  // Insert chapters
                  for (const ch of epInfo.chapters || []) {
                    trx.run(`
                      INSERT INTO media_chapters (id, media_id, chapter_index, start_time, end_time, title)
                      VALUES (?, ?, ?, ?, ?, ?)
                    `, [generateId('chap'), episodeId, ch.chapterIndex, ch.startTime, ch.endTime, ch.title]);
                  }
                });

                addedCount++;
                console.log(`[FileScanner] Indexed Episode: ${showTitle} S${seasonNum}E${item.parsed.episodeNumber} - "${epTitle}" [${epInfo.resolution} | ${epInfo.hdrFormat}]`);
              }
            }
          } catch (err) {
            console.error(`[FileScanner] Error indexing show ${showTitle}:`, err);
          }
        }
      }
    }

    console.log(`[FileScanner] Completed scan for library "${library.name}". Added ${addedCount} items.`);
    return { addedCount, updatedCount };
  }

  /**
   * Watch directories for real-time changes
   */
  startWatcher(libraryId) {
    const library = db.queryOne('SELECT * FROM libraries WHERE id = ?', [libraryId]);
    if (!library) return;

    const paths = JSON.parse(library.paths || '[]');
    if (this.watchers.has(libraryId)) {
      this.watchers.get(libraryId).close();
    }

    const watcher = chokidar.watch(paths, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 }
    });

    watcher.on('add', (filePath) => {
      if (isVideoFile(filePath)) {
        console.log(`[Watcher] New video detected: ${filePath}`);
        this.scanLibrary(libraryId);
      }
    });

    watcher.on('unlink', (filePath) => {
      if (isVideoFile(filePath)) {
        console.log(`[Watcher] Video removed: ${filePath}`);
        db.run('DELETE FROM media_items WHERE file_path = ?', [filePath]);
        db.run('DELETE FROM tv_episodes WHERE file_path = ?', [filePath]);
      }
    });

    this.watchers.set(libraryId, watcher);
  }
}

export const scanner = new FileScanner();
