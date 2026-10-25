import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import fs from 'node:fs';

function parseVttTime(str) {
  const parts = str.trim().split(':');
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s);
  } else if (parts.length === 2) {
    const [m, s] = parts;
    return parseInt(m, 10) * 60 + parseFloat(s);
  }
  return 0;
}

function formatVttTime(seconds, includeHours = false) {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.min(999, Math.floor(Math.round((clamped % 1) * 1000)));
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  if (h > 0 || includeHours) {
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
  }
  return `${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

export function createVttOffsetTransform(offsetSeconds) {
  let buffer = '';
  return new Transform({
    transform(chunk, encoding, callback) {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep trailing incomplete line

      let output = '';
      for (const line of lines) {
        const match = line.match(/^((?:\d{2}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}\.\d{3})(.*)$/);
        if (match) {
          const start = parseVttTime(match[1]) + offsetSeconds;
          const end = parseVttTime(match[2]) + offsetSeconds;
          if (end <= 0) {
            // Drop cue that ended before 0.0s
            continue;
          }
          const hasHours = match[1].split(':').length === 3 || match[2].split(':').length === 3 || start >= 3600 || end >= 3600;
          const newStart = formatVttTime(Math.max(0, start), hasHours);
          const newEnd = formatVttTime(Math.max(0, end), hasHours);
          output += `${newStart} --> ${newEnd}${match[3]}\n`;
        } else {
          output += `${line}\n`;
        }
      }
      callback(null, output);
    },
    flush(callback) {
      if (buffer.length > 0) {
        const match = buffer.match(/^((?:\d{2}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}\.\d{3})(.*)$/);
        if (match) {
          const start = parseVttTime(match[1]) + offsetSeconds;
          const end = parseVttTime(match[2]) + offsetSeconds;
          if (end > 0) {
            const hasHours = match[1].split(':').length === 3 || match[2].split(':').length === 3 || start >= 3600 || end >= 3600;
            const newStart = formatVttTime(Math.max(0, start), hasHours);
            const newEnd = formatVttTime(Math.max(0, end), hasHours);
            callback(null, `${newStart} --> ${newEnd}${match[3]}\n`);
            return;
          }
        } else {
          callback(null, buffer);
          return;
        }
      }
      callback();
    }
  });
}

/**
 * Live WebVTT Subtitle Server
 * Extracts embedded or external subtitle tracks to WebVTT on-the-fly
 * Supports subtitle sync timing offset (delay or advance in seconds)
 */
export function streamSubtitles(req, res, filePath, streamIndex = 0, offset = 0) {
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Media file not found');
  }

  res.writeHead(200, {
    'Content-Type': 'text/vtt; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  });

  const offsetNum = parseFloat(offset || req?.query?.offset || 0);

  const args = [
    '-i', filePath,
    '-map', `0:${streamIndex}`,
    '-f', 'webvtt',
    'pipe:1'
  ];

  const ffmpeg = spawn('ffmpeg', args, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (offsetNum !== 0 && !isNaN(offsetNum)) {
    const transform = createVttOffsetTransform(offsetNum);
    ffmpeg.stdout.pipe(transform).pipe(res);
  } else {
    ffmpeg.stdout.pipe(res);
  }

  ffmpeg.on('error', (err) => {
    console.error('[SubtitleServer] Stream extraction error:', err.message);
    if (!res.headersSent) res.status(500).end();
  });

  req.on('close', () => {
    if (!ffmpeg.killed) {
      ffmpeg.kill('SIGTERM');
    }
  });
}
