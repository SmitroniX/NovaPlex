# NovaPlex Task List

## Phase 1: Foundation & Database Layer
- [x] Task 1.1: Initialize monorepo root package.json and server package.json
- [x] Task 1.2: Implement schema.sql and database.js using native node:sqlite
- [x] Task 1.3: Create and execute server/test/db.test.js
- [x] Checkpoint 1: Database initialized and verified

## Phase 2: Media Scanner & 4K / HDR10+ Analyzer
- [x] Task 2.1: Implement nameParser.js (regex title, year, season, episode parsing)
- [x] Task 2.2: Implement ffprobeAnalyzer.js (4K, HDR10+, color space, audio/sub streams)
- [x] Task 2.3: Implement metadataFetcher.js (TMDB/TVMaze/Cinemeta scraper & image cache)
- [x] Task 2.4: Implement fileScanner.js (crawler & chokidar watcher)
- [x] Checkpoint 2: Scanner & metadata scraper verified

## Phase 3: 4K Transcoding & "Turn Off HDR" Tonemapping Engine
- [x] Task 3.1: Implement directPlayer.js (HTTP Range 206 for 4K HDR bit-for-bit Direct Play)
- [x] Task 3.2: Implement remuxer.js (instant MKV to fMP4 container swap with -c copy)
- [x] Task 3.3: Implement hlsTranscoder.js (4K/1080p/720p/480p with HDR-to-SDR tonemap when HDR is OFF)
- [x] Task 3.4: Implement subtitleServer.js (live WebVTT stream extraction)
- [x] Checkpoint 3: Streaming & tonemapping engine verified

## Phase 4: Server REST API Gateway
- [x] Task 4.1: Build Express server in server/src/server.js
- [x] Task 4.2: Implement routes for libraries, media, stream, users, and playback progress
- [x] Checkpoint 4: REST API verified

## Phase 5: Apple Liquid Glass Client & NovaPlayer
- [x] Task 5.1: Scaffold React 19 + Vite + Tailwind CSS client with Liquid Glass tokens
- [x] Task 5.2: Build Apple floating glass Navbar, User Switcher, and Search Modal
- [x] Task 5.3: Build Library View with 4K / HDR10+ badges and filter pills
- [x] Task 5.4: Build Continue Watching row with watch progress bars
- [x] Task 5.5: Build Media Detail Modal with blurred backdrop, cast avatars, and episodes
- [x] Task 5.6: Build NovaPlayer with HDR toggle [HDR: ON / HDR: OFF (SDR Tonemap)], audio tracks, WebVTT subs, 4K quality dropdown
- [x] Task 5.7: Configure PWA Manifest and Service Worker
- [x] Checkpoint 5: Client builds cleanly and connects to backend

## Phase 6: End-to-End Integration & Verification
- [x] Task 6.1: Setup test media in NovaPlex/media/
- [x] Task 6.2: Run automated test suite
- [x] Task 6.3: End-to-end playback test and verification
- [x] Checkpoint 6: Ready for production
