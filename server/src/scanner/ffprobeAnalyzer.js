import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { db } from '../db/database.js';

const execFileAsync = promisify(execFile);

/**
 * Execute ffprobe to extract detailed container, video, audio, and subtitle metadata
 */
export async function analyzeMediaFile(filePath) {
  try {
    let probeTarget = filePath;
    const isStrm = typeof filePath === 'string' && filePath.toLowerCase().endsWith('.strm');
    const extraArgs = [];

    if (isStrm && fs.existsSync(filePath)) {
      try {
        const streamUrl = fs.readFileSync(filePath, 'utf-8').trim();
        if (streamUrl.startsWith('http://') || streamUrl.startsWith('https://')) {
          probeTarget = streamUrl;
          if (streamUrl.includes('gofile.io') || streamUrl.includes('.gofile.')) {
            const token = db.queryOne("SELECT value FROM server_settings WHERE key = 'gofile_token'")?.value || process.env.GOFILE_TOKEN || '';
            extraArgs.push('-headers', `Authorization: Bearer ${token}\r\n`);
          }
        }
      } catch (e) {
        // Fallback to local path if read error
      }
    }

    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      ...extraArgs,
      '-show_format',
      '-show_streams',
      '-show_chapters',
      probeTarget
    ];

    const { stdout } = await execFileAsync('ffprobe', args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: isStrm ? 25000 : 30000
    });
    const data = JSON.parse(stdout);

    const format = data.format || {};
    const streams = data.streams || [];

    const videoStream = streams.find(s => s.codec_type === 'video');
    const audioStreams = streams.filter(s => s.codec_type === 'audio');
    const subtitleStreams = streams.filter(s => s.codec_type === 'subtitle');

    // 1. Video analysis
    let width = videoStream?.width || 1920;
    let height = videoStream?.height || 1080;
    let resolution = '1080p FHD';
    if (width >= 3800 || height >= 2000) {
      resolution = '4K UHD';
    } else if (width >= 1900 || height >= 1000) {
      resolution = '1080p FHD';
    } else if (width >= 1200 || height >= 700) {
      resolution = '720p HD';
    } else {
      resolution = '480p SD';
    }

    const pixFmt = videoStream?.pix_fmt || 'yuv420p';
    const is10Bit = pixFmt.includes('10') || (videoStream?.bits_per_raw_sample === '10');
    const bitDepth = is10Bit ? 10 : 8;

    const colorSpace = videoStream?.color_space || 'bt709';
    const colorTransfer = videoStream?.color_transfer || 'bt709';
    const colorPrimaries = videoStream?.color_primaries || 'bt709';

    // 2. HDR detection (HDR10, HDR10+, HLG, Dolby Vision, SDR)
    let hdrFormat = 'SDR';
    const sideDataList = videoStream?.side_data_list || [];
    const hasDovi = sideDataList.some(sd => sd.side_data_type && sd.side_data_type.toLowerCase().includes('dovi'));
    const hasHDR10Plus = sideDataList.some(sd => 
      sd.side_data_type && sd.side_data_type.toLowerCase().includes('hdr10+')
    );

    if (hasDovi) {
      hdrFormat = 'Dolby Vision';
    } else if (hasHDR10Plus) {
      hdrFormat = 'HDR10+';
    } else if (colorTransfer === 'smpte2084') {
      hdrFormat = 'HDR10';
    } else if (colorTransfer === 'arib-std-b67') {
      hdrFormat = 'HLG';
    } else if (colorPrimaries === 'bt2020' && is10Bit) {
      hdrFormat = 'HDR10';
    }

    // 3. Audio analysis
    const primaryAudio = audioStreams[0];
    const audioCodec = primaryAudio?.codec_name || 'aac';
    const audioChannels = primaryAudio?.channels || 2;

    const parsedAudioStreams = audioStreams.map(s => {
      const lang = s.tags?.language || 'und';
      const title = s.tags?.title || `${s.codec_name?.toUpperCase() || 'Audio'} ${s.channels || 2}ch (${lang})`;
      return {
        streamIndex: s.index,
        codec: s.codec_name || 'aac',
        language: lang,
        title,
        channels: s.channels || 2,
        channelLayout: s.channel_layout || 'stereo',
        isDefault: s.disposition?.default === 1 ? 1 : 0
      };
    });

    // 4. Subtitle analysis
    const parsedSubtitleStreams = subtitleStreams.map(s => {
      const lang = s.tags?.language || 'und';
      const title = s.tags?.title || `Subtitles (${lang})`;
      return {
        streamIndex: s.index,
        codec: s.codec_name || 'subrip',
        language: lang,
        title,
        isDefault: s.disposition?.default === 1 ? 1 : 0,
        isForced: s.disposition?.forced === 1 ? 1 : 0
      };
    });

    // 5. Chapter analysis
    const rawChapters = data.chapters || [];
    const durationSeconds = parseFloat(format.duration || 0);
    let parsedChapters = rawChapters.map((c, idx) => {
      let start = parseFloat(c.start_time);
      if (isNaN(start) && c.start !== undefined && c.time_base) {
        const [num, den] = c.time_base.split('/').map(Number);
        if (den) start = (c.start * num) / den;
      }
      let end = parseFloat(c.end_time);
      if (isNaN(end) && c.end !== undefined && c.time_base) {
        const [num, den] = c.time_base.split('/').map(Number);
        if (den) end = (c.end * num) / den;
      }
      return {
        chapterIndex: idx,
        startTime: isNaN(start) ? 0 : Math.max(0, start),
        start_time: isNaN(start) ? 0 : Math.max(0, start),
        endTime: isNaN(end) ? 0 : Math.max(0, end),
        end_time: isNaN(end) ? 0 : Math.max(0, end),
        title: c.tags?.title || `Chapter ${idx + 1}`
      };
    });

    if (parsedChapters.length > 0) {
      // Sort and ensure monotonic non-overlapping chapters
      parsedChapters.sort((a, b) => a.startTime - b.startTime);
      for (let i = 0; i < parsedChapters.length; i++) {
        parsedChapters[i].chapterIndex = i;
        if (parsedChapters[i].endTime <= parsedChapters[i].startTime) {
          if (i < parsedChapters.length - 1 && parsedChapters[i + 1].startTime > parsedChapters[i].startTime) {
            parsedChapters[i].endTime = parsedChapters[i + 1].startTime;
            parsedChapters[i].end_time = parsedChapters[i + 1].startTime;
          } else if (durationSeconds > parsedChapters[i].startTime) {
            parsedChapters[i].endTime = durationSeconds;
            parsedChapters[i].end_time = durationSeconds;
          }
        }
      }
    }

    // If file has no embedded chapters, provide logical chapter markers based on duration
    if (parsedChapters.length === 0 && durationSeconds > 0) {
      if (durationSeconds >= 300) {
        // Standard intro range 0:45 - 2:15 (45s to 135s)
        const introEnd = Math.min(135, Math.max(75, durationSeconds * 0.08));
        parsedChapters = [
          { chapterIndex: 0, startTime: 0, start_time: 0, endTime: 45, end_time: 45, title: 'Cold Open' },
          { chapterIndex: 1, startTime: 45, start_time: 45, endTime: introEnd, end_time: introEnd, title: 'Intro' },
          { chapterIndex: 2, startTime: introEnd, start_time: introEnd, endTime: Math.floor(durationSeconds * 0.45), end_time: Math.floor(durationSeconds * 0.45), title: 'Part I' },
          { chapterIndex: 3, startTime: Math.floor(durationSeconds * 0.45), start_time: Math.floor(durationSeconds * 0.45), endTime: Math.floor(durationSeconds * 0.8), end_time: Math.floor(durationSeconds * 0.8), title: 'Part II' },
          { chapterIndex: 4, startTime: Math.floor(durationSeconds * 0.8), start_time: Math.floor(durationSeconds * 0.8), endTime: Math.max(durationSeconds - 90, Math.floor(durationSeconds * 0.92)), end_time: Math.max(durationSeconds - 90, Math.floor(durationSeconds * 0.92)), title: 'Climax' },
          { chapterIndex: 5, startTime: Math.max(durationSeconds - 90, Math.floor(durationSeconds * 0.92)), start_time: Math.max(durationSeconds - 90, Math.floor(durationSeconds * 0.92)), endTime: durationSeconds, end_time: durationSeconds, title: 'Credits' }
        ];
      } else if (durationSeconds >= 15) {
        const p1 = Math.min(4, durationSeconds * 0.2);
        const p2 = Math.min(12, durationSeconds * 0.6);
        const p3 = Math.max(durationSeconds - 4, durationSeconds * 0.85);
        parsedChapters = [
          { chapterIndex: 0, startTime: 0, start_time: 0, endTime: p1, end_time: p1, title: 'Intro' },
          { chapterIndex: 1, startTime: p1, start_time: p1, endTime: p2, end_time: p2, title: 'Part I' },
          { chapterIndex: 2, startTime: p2, start_time: p2, endTime: p3, end_time: p3, title: 'Part II' },
          { chapterIndex: 3, startTime: p3, start_time: p3, endTime: durationSeconds, end_time: durationSeconds, title: 'Credits' }
        ];
      }
    }

    const titleTag = format.tags?.title || videoStream?.tags?.title || '';

    return {
      titleTag,
      durationSeconds,
      fileSize: parseInt(format.size || 0, 10),
      container: format.format_name?.split(',')[0] || 'mkv',
      videoCodec: videoStream?.codec_name || 'h264',
      resolution,
      width,
      height,
      pixFmt,
      bitDepth,
      colorSpace,
      colorTransfer,
      colorPrimaries,
      hdrFormat,
      audioCodec,
      audioChannels,
      audioStreams: parsedAudioStreams,
      subtitleStreams: parsedSubtitleStreams,
      chapters: parsedChapters
    };
  } catch (err) {
    console.error(`[ffprobe] Error analyzing file ${filePath}:`, err.message);
    // Return sensible fallback
    return {
      durationSeconds: 0,
      fileSize: 0,
      container: 'mp4',
      videoCodec: 'h264',
      resolution: '1080p FHD',
      width: 1920,
      height: 1080,
      pixFmt: 'yuv420p',
      bitDepth: 8,
      colorSpace: 'bt709',
      colorTransfer: 'bt709',
      colorPrimaries: 'bt709',
      hdrFormat: 'SDR',
      audioCodec: 'aac',
      audioChannels: 2,
      audioStreams: [],
      subtitleStreams: [],
      chapters: []
    };
  }
}
