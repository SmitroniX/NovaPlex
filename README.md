# 🍎 NovaPlex — Apple Liquid Glass Media Server & Cinema PWA

> **A high-performance personal media server and client ecosystem engineered with an Apple visionOS / macOS frosted Liquid Glass interface, 4K Ultra HD transcoding, native HDR10 / HDR10+ pass-through, and real-time HDR-to-SDR tonemapping.**

---

## ✨ Highlights & Architecture

### 💎 1. Apple Liquid Glass User Interface
- **visionOS & macOS Aesthetic**: Ultra-deep frosted glassmorphism (`backdrop-blur-3xl`, `bg-white/[0.08]`, `border-white/[0.18]`, specular highlights, and ambient light glow mesh; zero harsh neon).
- **Floating Glass Pill Controls**: Fluid navigation bar, category selector chips, and auto-hiding floating player controls.
- **Dynamic Media Cards**: Rounded chiclet cards with subtle hover elevation, 4K / HDR10+ badges, and IMDb rating chips.
- **PWA Ready**: 1-click installable web app on iPhone, iPad, Mac, Android, and Windows with standalone fullscreen display.

### 🎥 2. 4K Ultra HD & Dynamic Range Engine
- **Up to 4K Transcoding**: Adaptive bitrate ladder with selectable quality profiles:
  - `4K Ultra HD` (2160p • 30 Mbps)
  - `1080p Full HD` (1080p • 10 Mbps)
  - `720p HD` (720p • 3.5 Mbps)
  - `480p SD` (480p • 1.2 Mbps)
  - `Direct Play`: 100% bit-for-bit passthrough (0% CPU usage)
- **HDR10 & HDR10+**: Automatic `ffprobe` detection of 10-bit color, BT.2020 color primaries, SMPTE 2084 (PQ), HLG, and HDR10+ dynamic metadata.
- **Interactive "Turn Off HDR" (HDR-to-SDR Tonemapping)**:
  - One-click player toggle: `[✨ HDR: ON]` ↔ `[🎨 HDR: OFF (SDR Tonemap)]`.
  - When HDR is turned off (or playing on SDR screens), real-time `ffmpeg` perceptual tonemapping (`tonemap=hable,format=yuv420p`) maps 10-bit BT.2020 down to rich, punchy Rec.709 SDR with zero washed-out grey tones!

### 📂 3. Automatic Media Scanner & Metadata Scraper
- **Smart Regex Parser**: Automatically identifies Movie titles, release years, TV Show names, Season numbers, and Episode numbers.
- **Metadata Fetcher**: Scrapes official posters, high-res backdrops, plot overviews, director, and cast members from TMDB (with TVMaze & Cinemeta fallbacks).
- **Local Image Cache**: Downloads and caches artwork locally to ensure fast, offline-resilient browsing.
- **Live Watcher**: Uses `chokidar` to detect new video files instantly.

### 🎬 4. NovaPlayer
- Custom HTML5 + HLS.js cinema video player.
- Multi-track audio stream selector (e.g. English 5.1, Commentary).
- Dynamic WebVTT subtitle extraction on-the-fly (`/api/stream/subtitles/...`).
- TV Show Binge Mode: Auto-next episode countdown prompt in the final 25 seconds.
- Keyboard navigation (Space for play/pause, Left/Right for 10s seek, F for fullscreen, M for mute, Esc to exit).

### 👥 5. Multi-User & Watch State Sync
- Profile switcher with optional 4-digit PIN locks.
- Real-time playback heartbeats every 5 seconds to `/api/playback/progress`.
- "Continue Watching" row with visual progress bar and 1-click resume.

---

## 🚀 Quick Start

### 1. Requirements
- **Node.js**: v20+ or v24+ (Node.js 24 recommended for native `node:sqlite`)
- **FFmpeg & FFprobe**: v6.0+

### 2. Start Production Server
```bash
cd /home/ubuntu/NovaPlex

# Run production server (serves API & bundled Liquid Glass PWA on port 5050)
npm start
```
Open **`http://localhost:5050`** in any web browser, tablet, or smartphone!

### 3. Development Mode
```bash
# Terminal 1 - Backend Server:
cd /home/ubuntu/NovaPlex/server
npm start

# Terminal 2 - Frontend Vite Dev Server:
cd /home/ubuntu/NovaPlex/client
npm run dev
```

---

## 🧪 Running Tests

The test suite covers database operations, filename regex parsing, `ffprobe` stream extraction, Direct Play HTTP Range requests, and HLS HDR-to-SDR tonemapping:

```bash
cd /home/ubuntu/NovaPlex
npm test
```

---

## 📁 Project Structure

```
/home/ubuntu/NovaPlex/
├── server/
│   ├── src/
│   │   ├── db/
│   │   │   ├── schema.sql           # SQLite schema (libraries, items, streams, watch progress)
│   │   │   └── database.js          # node:sqlite DatabaseSync wrapper
│   │   ├── scanner/
│   │   │   ├── fileScanner.js       # Directory crawler & chokidar live watcher
│   │   │   ├── nameParser.js        # Movie and TV episode regex extractor
│   │   │   └── ffprobeAnalyzer.js   # 4K & HDR10+ metadata & stream extractor
│   │   ├── metadata/
│   │   │   └── metadataFetcher.js   # TMDB / TVMaze scraper & local artwork cache
│   │   ├── stream/
│   │   │   ├── directPlayer.js      # HTTP 206 Range server (0% CPU Direct Play)
│   │   │   ├── remuxer.js           # ffmpeg -c copy container remuxer
│   │   │   ├── hlsTranscoder.js     # 4K HLS transcoder with HDR-to-SDR tonemapping
│   │   │   └── subtitleServer.js    # On-the-fly WebVTT extractor
│   │   ├── routes/
│   │   │   ├── libraries.js         # Library management & scan triggers
│   │   │   ├── media.js             # Media catalog & filtering
│   │   │   ├── stream.js            # Direct, Remux, HLS 4K, Subtitle routes
│   │   │   ├── users.js             # Profiles & PIN authentication
│   │   │   ├── playback.js          # Real-time watch progress sync
│   │   │   └── settings.js          # Server configuration & stats
│   │   └── server.js                # Express app & static server on port 5050
│   └── test/
│       ├── db.test.js               # Database schema & cascade test
│       ├── scanner.test.js          # Filename parsing & ffprobe test
│       ├── stream.test.js           # Direct Play range & tonemap test
│       └── e2e.test.js              # Full library scan & progress sync test
├── client/
│   ├── public/
│   │   ├── manifest.json            # PWA manifest
│   │   ├── service-worker.js        # Offline PWA service worker
│   │   └── favicon.svg
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.jsx           # Floating Apple glass pill navigation
│   │   │   ├── LiquidBackground.jsx # Ambient fluid glow mesh
│   │   │   ├── LibraryView.jsx      # Filter pills & media card grid
│   │   │   ├── MediaCard.jsx        # Glass chiclet cards with 4K / HDR10+ badges
│   │   │   ├── ContinueWatching.jsx # On-deck resume carousel
│   │   │   ├── MediaDetailModal.jsx # Frosted glass modal with episode guide
│   │   │   ├── NovaPlayer.jsx       # Cinema player with HDR ON/OFF toggle, 4K quality, tracks
│   │   │   ├── ServerSettings.jsx   # Server settings modal
│   │   │   ├── UserSelectModal.jsx  # Profile selector & PIN input
│   │   │   └── SearchModal.jsx      # Command palette search (⌘K)
│   │   ├── context/
│   │   │   ├── ServerContext.jsx    # Server state & catalog
│   │   │   └── PlayerContext.jsx    # Active playback, HDR mode, tracks
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css                # Apple liquid glass Tailwind styles
│   └── vite.config.js
├── media/
│   ├── movies/                      # Movie folder
│   └── shows/                       # TV Shows folder
└── package.json
```
