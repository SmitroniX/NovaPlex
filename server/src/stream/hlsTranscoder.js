import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/database.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRANSCODE_ROOT = path.resolve(__dirname, '../../data/transcode');
if (!fs.existsSync(TRANSCODE_ROOT)) {
  fs.mkdirSync(TRANSCODE_ROOT, { recursive: true });
}

// Active HLS Transcode Sessions
const activeSessions = new Map();

// High Bitrate & Optimized Real-Time Quality Preset Configurations (Fast, Smooth & Buffer-Free)
export const PROFILES = {
  'lossless': {
    copyVideo: true,
    bitrate: '50M',
    bufsize: '100M',
    crf: 17,
    preset: 'ultrafast',
    audioBitrate: '320k'
  },
  'direct': {
    copyVideo: true,
    bitrate: '50M',
    bufsize: '100M',
    crf: 18,
    preset: 'ultrafast',
    audioBitrate: '320k'
  },
  '4k': {
    width: 3840,
    height: 2160,
    bitrate: '40M',
    bufsize: '80M',
    crf: 18,
    preset: 'ultrafast',
    audioBitrate: '320k'
  },
  '1080p': {
    width: 1920,
    height: 1080,
    bitrate: '20M',
    bufsize: '40M',
    crf: 20,
    preset: 'ultrafast',
    audioBitrate: '256k'
  },
  '720p': {
    width: 1280,
    height: 720,
    bitrate: '10M',
    bufsize: '20M',
    crf: 22,
    preset: 'ultrafast',
    audioBitrate: '192k'
  },
  '480p': {
    width: 854,
    height: 480,
    bitrate: '3M',
    bufsize: '6M',
    crf: 24,
    preset: 'ultrafast',
    audioBitrate: '128k'
  }
};

/**
 * Hardware Acceleration Detection & Status
 */
let detectedHwaccel = null;

export async function detectHardwareCapabilities() {
  if (detectedHwaccel !== null) return detectedHwaccel;

  const hasDri = fs.existsSync('/dev/dri/renderD128') || fs.existsSync('/dev/dri/card0');
  const hasNvidia = fs.existsSync('/dev/nvidia0') || fs.existsSync('/dev/nvidiactl');

  let mode = 'cpu';
  let encoder = 'libx264';
  let devicePath = null;

  // 1. Check NVIDIA GPU (CUDA / NVENC)
  if (hasNvidia) {
    try {
      await execFileAsync('ffmpeg', [
        '-hwaccel', 'cuda',
        '-f', 'lavfi', '-i', 'nullsrc=s=128x128:d=0.05',
        '-c:v', 'h264_nvenc',
        '-f', 'null', '-'
      ], { timeout: 2000 });
      mode = 'cuda';
      encoder = 'h264_nvenc';
    } catch (_) {}
  }

  // 2. Check VAAPI / Intel QuickSync
  if (mode === 'cpu' && hasDri) {
    const dev = fs.existsSync('/dev/dri/renderD128') ? '/dev/dri/renderD128' : '/dev/dri/card0';
    try {
      await execFileAsync('ffmpeg', [
        '-init_hw_device', `vaapi=va:${dev}`,
        '-f', 'lavfi', '-i', 'nullsrc=s=128x128:d=0.05',
        '-vf', 'format=nv12,hwupload',
        '-c:v', 'h264_vaapi',
        '-f', 'null', '-'
      ], { timeout: 2000 });
      mode = 'vaapi';
      encoder = 'h264_vaapi';
      devicePath = dev;
    } catch (_) {
      try {
        await execFileAsync('ffmpeg', [
          '-hwaccel', 'qsv',
          '-f', 'lavfi', '-i', 'nullsrc=s=128x128:d=0.05',
          '-c:v', 'h264_qsv',
          '-f', 'null', '-'
        ], { timeout: 2000 });
        mode = 'qsv';
        encoder = 'h264_qsv';
      } catch (_) {}
    }
  }

  detectedHwaccel = {
    mode,
    encoder,
    devicePath,
    hasDri,
    hasNvidia,
    isHardwareAccelerated: mode !== 'cpu'
  };

  console.log(`[HLSTranscoder] Hardware acceleration capability: ${mode.toUpperCase()} (Encoder: ${encoder}, DRI: ${hasDri}, NVIDIA: ${hasNvidia})`);
  return detectedHwaccel;
}

export function getHardwareAccelerationInfo() {
  return detectedHwaccel || {
    mode: 'cpu',
    encoder: 'libx264',
    hasDri: fs.existsSync('/dev/dri/renderD128'),
    hasNvidia: fs.existsSync('/dev/nvidia0'),
    isHardwareAccelerated: false
  };
}

// Initial probe
detectHardwareCapabilities().catch(() => {});

/**
 * Check if the media source is true HDR
 */
function checkIsSourceHDR(filePath, mediaId) {
  try {
    if (filePath) {
      const ep = db.queryOne('SELECT hdr_format, color_transfer FROM tv_episodes WHERE file_path = ?', [filePath]);
      if (ep) {
        const hdr = (ep.hdr_format || '').toLowerCase();
        const tr = (ep.color_transfer || '').toLowerCase();
        if (hdr.includes('hdr') || hdr.includes('dv') || hdr.includes('dovi') || hdr.includes('hlg') || tr.includes('2084') || tr.includes('arib')) {
          return true;
        }
        return false;
      }
      const item = db.queryOne('SELECT hdr_format, color_transfer FROM media_items WHERE file_path = ?', [filePath]);
      if (item) {
        const hdr = (item.hdr_format || '').toLowerCase();
        const tr = (item.color_transfer || '').toLowerCase();
        if (hdr.includes('hdr') || hdr.includes('dv') || hdr.includes('dovi') || hdr.includes('hlg') || tr.includes('2084') || tr.includes('arib')) {
          return true;
        }
        return false;
      }
    }
    if (mediaId) {
      const ep = db.queryOne('SELECT hdr_format, color_transfer FROM tv_episodes WHERE id = ?', [mediaId]);
      if (ep) {
        const hdr = (ep.hdr_format || '').toLowerCase();
        const tr = (ep.color_transfer || '').toLowerCase();
        if (hdr.includes('hdr') || hdr.includes('dv') || hdr.includes('dovi') || hdr.includes('hlg') || tr.includes('2084') || tr.includes('arib')) {
          return true;
        }
        return false;
      }
      const item = db.queryOne('SELECT hdr_format, color_transfer FROM media_items WHERE id = ?', [mediaId]);
      if (item) {
        const hdr = (item.hdr_format || '').toLowerCase();
        const tr = (item.color_transfer || '').toLowerCase();
        if (hdr.includes('hdr') || hdr.includes('dv') || hdr.includes('dovi') || hdr.includes('hlg') || tr.includes('2084') || tr.includes('arib')) {
          return true;
        }
        return false;
      }
    }
  } catch (_) {}
  return false;
}

/**
 * Check if the media video codec is H.264 / AVC (natively copyable into HLS MPEG-TS)
 */
export function checkIsH264(filePath, mediaId) {
  try {
    if (filePath) {
      const ep = db.queryOne('SELECT video_codec FROM tv_episodes WHERE file_path = ?', [filePath]);
      if (ep?.video_codec) {
        const c = ep.video_codec.toLowerCase();
        return c === 'h264' || c === 'avc';
      }
      const item = db.queryOne('SELECT video_codec FROM media_items WHERE file_path = ?', [filePath]);
      if (item?.video_codec) {
        const c = item.video_codec.toLowerCase();
        return c === 'h264' || c === 'avc';
      }
    }
    if (mediaId) {
      const ep = db.queryOne('SELECT video_codec FROM tv_episodes WHERE id = ?', [mediaId]);
      if (ep?.video_codec) {
        const c = ep.video_codec.toLowerCase();
        return c === 'h264' || c === 'avc';
      }
      const item = db.queryOne('SELECT video_codec FROM media_items WHERE id = ?', [mediaId]);
      if (item?.video_codec) {
        const c = item.video_codec.toLowerCase();
        return c === 'h264' || c === 'avc';
      }
    }
  } catch (_) {}
  return true;
}

/**
 * Build ffmpeg arguments for transcoding or remuxing
 */
function buildFfmpegArgs({
  filePath,
  startTime,
  audioTrackIndex,
  canCopyVideo,
  profile,
  applyTonemap,
  hwMode = 'cpu',
  devicePath = null,
  playlistPath,
  segmentPattern
}) {
  const args = ['-y'];

  // Hardware acceleration input configuration
  if (!canCopyVideo) {
    if (hwMode === 'vaapi' && devicePath) {
      args.push('-init_hw_device', `vaapi=va:${devicePath}`, '-hwaccel', 'vaapi', '-hwaccel_device', 'va');
    } else if (hwMode === 'cuda') {
      args.push('-hwaccel', 'cuda');
    } else if (hwMode === 'qsv') {
      args.push('-hwaccel', 'qsv');
    }
  }

  if (startTime > 0) {
    args.push('-ss', String(startTime));
  }

  let inputSource = filePath;
  const isStrm = typeof filePath === 'string' && filePath.toLowerCase().endsWith('.strm');
  if (isStrm && fs.existsSync(filePath)) {
    try {
      const streamUrl = fs.readFileSync(filePath, 'utf-8').trim();
      if (streamUrl.startsWith('http://') || streamUrl.startsWith('https://')) {
        inputSource = streamUrl;
        if (streamUrl.includes('gofile.io') || streamUrl.includes('.gofile.')) {
          const token = db.queryOne("SELECT value FROM server_settings WHERE key = 'gofile_token'")?.value || process.env.GOFILE_TOKEN || '';
          args.push('-headers', `Authorization: Bearer ${token}\r\n`);
        }
      }
    } catch (e) {
      console.warn('[HLSTranscoder] Could not read .strm file:', e.message);
    }
  }

  // Network stream reconnect parameters for remote storage (e.g. Gofile CDN)
  if (typeof inputSource === 'string' && (inputSource.startsWith('http://') || inputSource.startsWith('https://'))) {
    args.push(
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5'
    );
  }

  args.push('-threads', '0');
  args.push('-i', inputSource);
  args.push('-threads', '0');
  args.push('-map', '0:v:0');

  if (audioTrackIndex !== null && audioTrackIndex !== undefined && audioTrackIndex !== '') {
    args.push('-map', `0:${audioTrackIndex}`);
  } else {
    args.push('-map', '0:a:0?');
  }

  args.push('-sn');

  if (canCopyVideo) {
    args.push(
      '-c:v', 'copy',
      '-fps_mode', 'passthrough',
      '-c:a', 'aac',
      '-b:a', profile.audioBitrate || '320k',
      '-ac', '2'
    );
  } else {
    let videoFilters = [];
    if (profile.width && profile.height) {
      videoFilters.push(`scale=w=${profile.width}:h=${profile.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`);
    } else {
      videoFilters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
    }
    if (applyTonemap) {
      videoFilters.push('tonemap=tonemap=hable:desat=0:peak=1000');
    }

    if (hwMode === 'vaapi') {
      videoFilters.push('format=nv12,hwupload');
      args.push(
        '-vf', videoFilters.join(','),
        '-c:v', 'h264_vaapi',
        '-b:v', profile.bitrate || '12M',
        '-maxrate', profile.bitrate || '12M',
        '-bufsize', profile.bufsize || '24M'
      );
    } else if (hwMode === 'cuda') {
      videoFilters.push('format=yuv420p');
      args.push(
        '-vf', videoFilters.join(','),
        '-c:v', 'h264_nvenc',
        '-preset', 'p4',
        '-tune', 'll',
        '-b:v', profile.bitrate || '12M',
        '-maxrate', profile.bitrate || '12M',
        '-bufsize', profile.bufsize || '24M'
      );
    } else if (hwMode === 'qsv') {
      videoFilters.push('format=yuv420p');
      args.push(
        '-vf', videoFilters.join(','),
        '-c:v', 'h264_qsv',
        '-preset', 'veryfast',
        '-b:v', profile.bitrate || '12M',
        '-maxrate', profile.bitrate || '12M',
        '-bufsize', profile.bufsize || '24M'
      );
    } else {
      // Software CPU transcoding - ultrafast preset for real-time buffer-free delivery
      videoFilters.push('format=yuv420p');
      args.push(
        '-vf', videoFilters.join(','),
        '-c:v', 'libx264',
        '-preset', profile.preset || 'ultrafast',
        '-tune', 'zerolatency',
        '-fps_mode', 'passthrough'
      );
      if (profile.crf !== undefined) {
        args.push('-crf', String(profile.crf));
      }
      if (profile.bitrate) {
        args.push('-maxrate', profile.bitrate, '-bufsize', profile.bufsize || profile.bitrate);
      }
    }

    args.push(
      '-force_key_frames', 'expr:gte(t,n_forced*3)',
      '-sc_threshold', '0',
      '-c:a', 'aac',
      '-b:a', profile.audioBitrate || '256k',
      '-ac', '2'
    );
  }

  if (startTime > 0) {
    args.push('-output_ts_offset', String(startTime));
  }

  args.push(
    '-f', 'hls',
    '-hls_time', '3',
    '-hls_list_size', '0',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', segmentPattern,
    playlistPath
  );

  return args;
}

/**
 * Helper to wait for the HLS playlist and first segment to appear
 */
async function waitForHlsPlaylist(playlistPath, processRef = null, maxWaitMs = 20000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (processRef && processRef.exitCode !== null && processRef.exitCode !== 0) {
        clearInterval(interval);
        return resolve(false);
      }
      if (fs.existsSync(playlistPath)) {
        try {
          const content = fs.readFileSync(playlistPath, 'utf-8');
          const tsCount = (content.match(/\.ts/g) || []).length;
          // Prefer 2 segments for smooth buffer, or 1 segment if elapsed > 2500ms
          if (tsCount >= 2 || (tsCount >= 1 && (Date.now() - start > 2500))) {
            clearInterval(interval);
            return resolve(true);
          }
        } catch (_) {}
      }
      if (Date.now() - start > maxWaitMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 100);
  });
}

/**
 * Get or create HLS transcode session with hardware acceleration & seamless software CPU fallback
 */
export async function getOrCreateHlsSession(
  mediaId,
  filePath,
  quality = 'direct',
  hdrMode = 'auto',
  startTime = 0,
  audioTrackIndex = null
) {
  const profileKey = PROFILES[quality] ? quality : 'direct';
  const profile = PROFILES[profileKey];
  const isSourceHDR = checkIsSourceHDR(filePath, mediaId);
  const isH264 = checkIsH264(filePath, mediaId);

  const applyTonemap = isSourceHDR && (hdrMode === 'off' || hdrMode === 'sdr');
  const canCopyVideo = Boolean(profile.copyVideo && !applyTonemap && isH264);

  const hwInfo = await detectHardwareCapabilities();
  const audKey = (audioTrackIndex !== null && audioTrackIndex !== undefined && audioTrackIndex !== '') ? `_a${audioTrackIndex}` : '';
  const hdrTag = applyTonemap ? 'sdr_tonemap' : (isSourceHDR ? 'hdr' : 'sdr');
  const sessionKey = `${mediaId}_${profileKey}_${hdrTag}${audKey}_ss${startTime}`;
  let session = activeSessions.get(sessionKey);

  if (session && fs.existsSync(session.playlistPath)) {
    session.lastAccessed = Date.now();
    return session;
  }

  // Immediately terminate any superseded sessions for this media to free CPU cores
  for (const [key, oldSession] of activeSessions.entries()) {
    if (oldSession.mediaId === mediaId && key !== sessionKey) {
      console.log(`[HLSTranscoder] Superseding session ${key} for media ${mediaId} to free CPU`);
      if (oldSession.process && !oldSession.process.killed) {
        try { oldSession.process.kill('SIGTERM'); } catch (_) {}
      }
      try {
        fs.rmSync(oldSession.dir, { recursive: true, force: true });
      } catch (_) {}
      activeSessions.delete(key);
    }
  }

  const sessionDir = path.join(TRANSCODE_ROOT, sessionKey);
  if (fs.existsSync(sessionDir)) {
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch (_) {}
  }
  fs.mkdirSync(sessionDir, { recursive: true });

  const playlistPath = path.join(sessionDir, 'stream.m3u8');
  const segmentPattern = path.join(sessionDir, 'segment-%04d.ts');

  // Determine initial acceleration mode
  let targetHwMode = canCopyVideo ? 'cpu' : hwInfo.mode;

  let ffmpegArgs = buildFfmpegArgs({
    filePath,
    startTime,
    audioTrackIndex,
    canCopyVideo,
    profile,
    applyTonemap,
    hwMode: targetHwMode,
    devicePath: hwInfo.devicePath,
    playlistPath,
    segmentPattern
  });

  console.log(`[HLSTranscoder] Starting session ${sessionKey} (Quality: ${profileKey}, Mode: ${canCopyVideo ? 'Bit-for-Bit Copy' : 'High-Bitrate Encode'}, HW: ${targetHwMode.toUpperCase()}, Source HDR: ${isSourceHDR}, Tonemap: ${applyTonemap}, Audio: ${audioTrackIndex ?? 'default'})`);

  let ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderrBuffer = '';
  ffmpegProcess.stderr.on('data', (d) => {
    stderrBuffer += d.toString();
  });

  // Track if hardware acceleration failed early and needs fallback
  let failedHw = false;
  ffmpegProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      if (targetHwMode !== 'cpu') {
        failedHw = true;
      }
      console.error(`[HLSTranscoder] Session ${sessionKey} (HW: ${targetHwMode}) exited with error code ${code}: ${stderrBuffer.slice(-300).trim()}`);
    } else {
      console.log(`[HLSTranscoder] Session ${sessionKey} process exited cleanly`);
    }
  });

  let ready = await waitForHlsPlaylist(playlistPath, ffmpegProcess, targetHwMode !== 'cpu' ? 5000 : 20000);

  // Automatic seamless fallback to software CPU transcoding if hardware acceleration failed
  if (!ready && targetHwMode !== 'cpu') {
    console.warn(`[HLSTranscoder] Hardware acceleration (${targetHwMode}) failed or timed out for ${sessionKey}. Falling back seamlessly to software CPU (libx264)...`);
    try {
      if (ffmpegProcess && !ffmpegProcess.killed) ffmpegProcess.kill('SIGTERM');
    } catch (_) {}

    // Disable failing hw mode so subsequent requests do not suffer repeat failures
    detectedHwaccel = {
      mode: 'cpu',
      encoder: 'libx264',
      devicePath: null,
      hasDri: hwInfo.hasDri,
      hasNvidia: hwInfo.hasNvidia,
      isHardwareAccelerated: false
    };

    targetHwMode = 'cpu';
    ffmpegArgs = buildFfmpegArgs({
      filePath,
      startTime,
      audioTrackIndex,
      canCopyVideo,
      profile,
      applyTonemap,
      hwMode: 'cpu',
      devicePath: null,
      playlistPath,
      segmentPattern
    });

    ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    stderrBuffer = '';
    ffmpegProcess.stderr.on('data', (d) => {
      stderrBuffer += d.toString();
    });

    ffmpegProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[HLSTranscoder] Software CPU fallback for ${sessionKey} exited with code ${code}:\n`, stderrBuffer.slice(-800));
      }
    });

    ready = await waitForHlsPlaylist(playlistPath, 20000);
  }

  session = {
    key: sessionKey,
    mediaId,
    quality: profileKey,
    hwMode: targetHwMode,
    hdrMode: applyTonemap ? 'SDR Tonemap' : (isSourceHDR ? 'HDR Passthrough' : 'SDR Direct'),
    startTime,
    dir: sessionDir,
    playlistPath,
    process: ffmpegProcess,
    lastAccessed: Date.now(),
    createdAt: Date.now()
  };

  activeSessions.set(sessionKey, session);
  return session;
}

/**
 * Periodic cleanup of inactive transcode sessions (idle > 35 seconds)
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of activeSessions.entries()) {
    if (now - session.lastAccessed > 35000) {
      console.log(`[HLSTranscoder] Cleaning up idle session ${key}...`);
      if (session.process && !session.process.killed) {
        session.process.kill('SIGTERM');
      }
      try {
        fs.rmSync(session.dir, { recursive: true, force: true });
      } catch (_) {}
      activeSessions.delete(key);
    }
  }
}, 15000);

export function touchHlsSession(sessionKey) {
  const session = activeSessions.get(sessionKey);
  if (session) {
    session.lastAccessed = Date.now();
  }
}

/**
 * Get info on all active HLS transcode sessions
 */
export function getActiveHlsSessions() {
  const sessions = [];
  const now = Date.now();
  for (const [key, session] of activeSessions.entries()) {
    sessions.push({
      key,
      mediaId: session.mediaId,
      quality: session.quality,
      hwMode: session.hwMode || 'cpu',
      hdrMode: session.hdrMode,
      startTime: session.startTime || 0,
      createdAt: session.createdAt || session.lastAccessed,
      lastAccessed: session.lastAccessed,
      uptimeSeconds: Math.floor((now - (session.createdAt || session.lastAccessed)) / 1000),
      pid: session.process?.pid || null,
      isActive: Boolean(session.process && !session.process.killed)
    });
  }
  return sessions;
}

/**
 * Terminate a single active HLS transcode session by key
 */
export function terminateHlsSession(sessionKey) {
  const session = activeSessions.get(sessionKey);
  if (session) {
    console.log(`[HLSTranscoder] Manually terminating session ${sessionKey}...`);
    if (session.process && !session.process.killed) {
      try {
        session.process.kill('SIGTERM');
      } catch (_) {}
    }
    try {
      if (fs.existsSync(session.dir)) {
        fs.rmSync(session.dir, { recursive: true, force: true });
      }
    } catch (_) {}
    activeSessions.delete(sessionKey);
    return true;
  }
  return false;
}

/**
 * Terminate all active HLS transcode sessions
 */
export function terminateAllHlsSessions() {
  let count = 0;
  for (const [key, session] of activeSessions.entries()) {
    if (session.process && !session.process.killed) {
      try {
        session.process.kill('SIGTERM');
      } catch (_) {}
    }
    try {
      if (fs.existsSync(session.dir)) {
        fs.rmSync(session.dir, { recursive: true, force: true });
      }
    } catch (_) {}
    count++;
  }
  activeSessions.clear();
  return count;
}

/**
 * Clean up the transcode cache directory on disk
 */
export function cleanTranscodeCache() {
  terminateAllHlsSessions();
  let freedCount = 0;
  if (fs.existsSync(TRANSCODE_ROOT)) {
    const entries = fs.readdirSync(TRANSCODE_ROOT);
    for (const entry of entries) {
      const entryPath = path.join(TRANSCODE_ROOT, entry);
      try {
        fs.rmSync(entryPath, { recursive: true, force: true });
        freedCount++;
      } catch (_) {}
    }
  }
  return freedCount;
}
