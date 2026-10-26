import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX,
  Maximize, Minimize, X, Sparkles, Sliders, MessageSquare,
  Volume1, Check, ArrowRight, AlertCircle, RefreshCw,
  Gauge, PictureInPicture, Settings2, ChevronDown,
  Activity, Copy, Clock, Zap, Sun, Headphones, Bookmark, Heart, FastForward
} from 'lucide-react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useServer } from '../context/ServerContext.jsx';

const QUALITIES = [
  { id: 'auto', label: 'Auto (ABR)', desc: 'Adaptive Bitrate • Automatic Dynamic Quality' },
  { id: 'lossless', label: 'Lossless Master', desc: 'CRF 0 • 85+ Mbps • Bit-for-Bit 60+ FPS' },
  { id: 'direct', label: 'Direct Stream', desc: 'Original Bitrate Passthrough • Native FPS' },
  { id: '4k', label: '4K Ultra HD', desc: '2160p • 65 Mbps Studio Master • 60 FPS' },
  { id: '1080p', label: '1080p Full HD', desc: '1080p • 25 Mbps High Bitrate • 60 FPS' },
  { id: '720p', label: '720p HD', desc: '720p • 12 Mbps Enhanced • 60 FPS' },
  { id: '480p', label: '480p SD', desc: '480p • 4 Mbps Low Bandwidth • 60 FPS' }
];

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

// Client-Side Stream Cache (Cache API for HLS Segments & Instant Seeking)
const STREAM_CACHE_NAME = 'novaplex-stream-cache-v1';

class CachedFragmentLoader extends Hls.DefaultConfig.loader {
  load(context, config, callbacks) {
    const url = context.url;
    // Only cache individual video segments (.ts or /segment/), never master.m3u8 playlists
    const isSegment = url.includes('.ts') || url.includes('/segment/');

    if (isSegment && typeof window !== 'undefined' && 'caches' in window) {
      window.caches.open(STREAM_CACHE_NAME).then((cache) => {
        cache.match(url).then((cachedResponse) => {
          if (cachedResponse) {
            cachedResponse.arrayBuffer().then((buffer) => {
              const now = performance.now();
              const stats = {
                trequest: now,
                tfirst: now,
                tload: now,
                loaded: buffer.byteLength,
                total: buffer.byteLength,
                bw: 0
              };
              if (typeof window !== 'undefined') {
                window.__novaplex_cache_hits = (window.__novaplex_cache_hits || 0) + 1;
              }
              callbacks.onSuccess({ url, data: buffer }, stats, context, null);
            }).catch(() => {
              super.load(context, config, callbacks);
            });
            return;
          }

          this.fetchAndCache(context, config, callbacks, cache);
        }).catch(() => {
          super.load(context, config, callbacks);
        });
      }).catch(() => {
        super.load(context, config, callbacks);
      });
      return;
    }

    super.load(context, config, callbacks);
  }

  fetchAndCache(context, config, callbacks, cache) {
    const origSuccess = callbacks.onSuccess;
    callbacks.onSuccess = (response, stats, ctx, networkDetails) => {
      if (response && response.data && cache) {
        try {
          const respToCache = new Response(response.data, {
            headers: {
              'Content-Type': 'video/MP2T',
              'Cache-Control': 'public, max-age=86400'
            }
          });
          cache.put(context.url, respToCache).catch(() => {});
          if (typeof window !== 'undefined') {
            window.__novaplex_cache_stored = (window.__novaplex_cache_stored || 0) + 1;
          }
        } catch (_) {}
      }
      if (origSuccess) {
        origSuccess(response, stats, ctx, networkDetails);
      }
    };
    super.load(context, config, callbacks);
  }
}

export default function NovaPlayer() {
  const {
    playingItem,
    closePlayer,
    quality,
    setQuality,
    hdrMode,
    setHdrMode,
    audioTracks,
    selectedAudioTrack,
    setSelectedAudioTrack,
    subtitleTracks,
    selectedSubtitleTrack,
    setSelectedSubtitleTrack,
    chapters,
    introRange,
    updateProgress
  } = usePlayer();

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const transcodeTimeoutRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const lastMediaKeyRef = useRef(null);
  const currentTimeRef = useRef(0);

  // Playback States
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [showRemainingTime, setShowRemainingTime] = useState(false);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [bufferedRange, setBufferedRange] = useState({ start: 0, end: 0 });

  // Player & Cinema UX Enhancement States
  const [brightness, setBrightness] = useState(1.0); // 0.2 to 1.5
  const [aspectRatioMode, setAspectRatioMode] = useState('contain'); // 'contain' (Fit), 'cover' (Fill/Crop), 'fill' (Stretch)
  const [subtitleOffset, setSubtitleOffset] = useState(0); // in seconds (-1.0s to +1.0s)
  const [speechClarity, setSpeechClarity] = useState(false); // Dialogue enhancement
  const [gestureIndicator, setGestureIndicator] = useState(null); // { type, value, percent }

  const getChapStart = (c) => (c ? (c.start_time ?? c.startTime ?? 0) : 0);
  const getChapEnd = (c) => (c ? (c.end_time ?? c.endTime ?? 0) : 0);

  const gestureTimeoutRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const highpassRef = useRef(null);
  const speechFilterRef = useRef(null);
  const compressorRef = useRef(null);
  const touchStateRef = useRef({
    startX: 0,
    startY: 0,
    startTime: 0,
    mode: null,
    startBrightness: 1.0,
    startVolume: 1.0,
    initialPinchDist: 0,
    hasMoved: false
  });

  // Scrubber Dragging / Scrubbing State
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const [hoverPosition, setHoverPosition] = useState(null); // { percent: 0-100, time: seconds }

  // UI / Controls Visibility States
  const [showControls, setShowControls] = useState(true);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [subMenuOpen, setSubMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
  const [mobileSettingsTab, setMobileSettingsTab] = useState('all'); // 'all', 'speed', 'quality', 'audio', 'subs'
  const [seekFeedback, setSeekFeedback] = useState(null); // { id, type: 'rewind'|'forward', text, targetTime }
  const [nextEpisodeCountdown, setNextEpisodeCountdown] = useState(null);

  // Jump to Particular Timestamp Modal State
  const [isJumpModalOpen, setIsJumpModalOpen] = useState(false);
  const [jumpInputVal, setJumpInputVal] = useState('');
  const [jumpInputError, setJumpInputError] = useState('');

  // Stats for Nerds (Live Stream Diagnostics & Performance HUD)
  const [showStatsForNerds, setShowStatsForNerds] = useState(false);
  const [copiedStats, setCopiedStats] = useState(false);
  const [nerdStats, setNerdStats] = useState({
    viewport: '1920x1080',
    optimalRes: '1920x1080',
    totalFrames: 0,
    droppedFrames: 0,
    dropRate: '0.00%',
    bufferHealth: '0.00s',
    bufferAheadSecs: 0,
    videoCodec: 'H.264 / AVC',
    audioCodec: 'AAC 5.1',
    streamMode: 'Direct Stream',
    hdrStatus: 'HDR10+ Passthrough',
    bitrate: '65 Mbps',
    bandwidth: 'Auto',
    playhead: '00:00:00.0',
    duration: '00:00:00.0',
    sessionKey: 'N/A',
    clientCache: 'Active (Cache API v1)'
  });

  // Precision Scrubber Refs
  const scrubberContainerRef = useRef(null);
  const wheelCommitTimeoutRef = useRef(null);
  const seekFeedbackTimeoutRef = useRef(null);
  const accumulatedSkipRef = useRef(0);
  const lastSkipDirectionRef = useRef(null);
  const isScrubbingRef = useRef(false);
  const isSeekingRef = useRef(false);
  const streamOffsetRef = useRef(0);
  const seekStallTimeoutRef = useRef(null);
  const lastTouchRevealTimeRef = useRef(0);
  const tapHistoryRef = useRef({ time: 0, x: 0, y: 0 });
  const singleTapTimerRef = useRef(null);

  // Error & Recovery States
  const [errorMessage, setErrorMessage] = useState(null);
  const [errorDetails, setErrorDetails] = useState('');
  const [reconnectToast, setReconnectToast] = useState(null);
  const [isTranscodeSlow, setIsTranscodeSlow] = useState(false);
  const [isDirectFileMode, setIsDirectFileMode] = useState(false);
  const retryAttemptRef = useRef(0);
  const mediaErrorCountRef = useRef(0);

  // Keep currentTimeRef in sync
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // Authoritative duration (handles both movies 'duration' and TV episodes 'duration_seconds')
  const itemDur = (
    (playingItem?.duration_seconds && Number(playingItem.duration_seconds) > 0 ? Number(playingItem.duration_seconds) : null) ||
    (playingItem?.duration && Number(playingItem.duration) > 0 ? Number(playingItem.duration) : null) ||
    (playingItem?.durationSeconds && Number(playingItem.durationSeconds) > 0 ? Number(playingItem.durationSeconds) : null) ||
    (duration > 0 ? duration : (videoRef.current?.duration && isFinite(videoRef.current.duration) ? videoRef.current.duration : 0))
  );
  const authoritativeDuration = itemDur || 0;

  const displayDuration = authoritativeDuration > 0 ? authoritativeDuration : duration;
  const activeCurrentTime = isScrubbing ? scrubTime : currentTime;
  const remainingTime = Math.max(0, displayDuration - activeCurrentTime);
  const progressPercent = displayDuration > 0 ? Math.min(100, Math.max(0, (activeCurrentTime / displayDuration) * 100)) : 0;
  const bufferedStartPercent = displayDuration > 0 ? Math.min(100, Math.max(0, (bufferedRange.start / displayDuration) * 100)) : 0;
  const bufferedEndPercent = displayDuration > 0 ? Math.min(100, Math.max(0, (bufferedRange.end / displayDuration) * 100)) : 0;
  const bufferedWidthPercent = Math.max(0, bufferedEndPercent - bufferedStartPercent);
  const bufferedPercent = bufferedEndPercent;

  // Intro Detection and State
  const introChapter = chapters?.find(c => {
    const isIntroTitle = /\b(intro|opening|theme|recap)\b/i.test(c.title) && !/^introduction$/i.test(c.title?.trim() || '');
    return isIntroTitle;
  });
  const effectiveIntro = introRange || (introChapter ? {
    start: getChapStart(introChapter),
    end: getChapEnd(introChapter)
  } : null);

  const isInsideIntro = Boolean(
    effectiveIntro &&
    activeCurrentTime >= effectiveIntro.start &&
    activeCurrentTime <= effectiveIntro.end
  );

  const [isIntroDismissed, setIsIntroDismissed] = useState(false);
  const [isIntroVisible, setIsIntroVisible] = useState(false);
  const introTimerRef = useRef(null);
  const wasInsideIntroRef = useRef(false);

  // Intro Auto-Dismissal and Visibility Management (5-second auto-hide)
  useEffect(() => {
    if (!effectiveIntro) {
      if (introTimerRef.current) {
        clearTimeout(introTimerRef.current);
        introTimerRef.current = null;
      }
      setIsIntroVisible(false);
      wasInsideIntroRef.current = false;
      return;
    }

    const cur = isScrubbing ? scrubTime : currentTime;
    const isInside = cur >= effectiveIntro.start && cur <= effectiveIntro.end;

    if (isInside) {
      // Just entered the intro range
      if (!wasInsideIntroRef.current) {
        wasInsideIntroRef.current = true;
        if (!isIntroDismissed) {
          setIsIntroVisible(true);
          if (introTimerRef.current) clearTimeout(introTimerRef.current);
          introTimerRef.current = setTimeout(() => {
            setIsIntroVisible(false);
            setIsIntroDismissed(true);
          }, 5000); // Auto-hide after 5 seconds if untouched
        }
      }
    } else {
      // Outside intro range: reset dismissal state so rewinding back before intro allows it to show again
      if (wasInsideIntroRef.current) {
        wasInsideIntroRef.current = false;
        if (introTimerRef.current) {
          clearTimeout(introTimerRef.current);
          introTimerRef.current = null;
        }
        setIsIntroVisible(false);
        setIsIntroDismissed(false);
      }
    }
  }, [currentTime, scrubTime, isScrubbing, effectiveIntro, isIntroDismissed]);

  // Reset intro state when media item changes
  useEffect(() => {
    if (introTimerRef.current) {
      clearTimeout(introTimerRef.current);
      introTimerRef.current = null;
    }
    setIsIntroVisible(false);
    setIsIntroDismissed(false);
    wasInsideIntroRef.current = false;
  }, [playingItem?.id, playingItem?.episodeId]);

  // Refs for timers & listeners
  const isPlayingRef = useRef(false);
  const showControlsRef = useRef(true);
  const menusOpenRef = useRef(false);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    showControlsRef.current = showControls;
  }, [showControls]);

  useEffect(() => {
    menusOpenRef.current = qualityMenuOpen || audioMenuOpen || subMenuOpen || speedMenuOpen || isMobileSettingsOpen || isJumpModalOpen || showStatsForNerds;
  }, [qualityMenuOpen, audioMenuOpen, subMenuOpen, speedMenuOpen, isMobileSettingsOpen, isJumpModalOpen, showStatsForNerds]);

  // Cleanup timers and audio context on unmount
  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      if (transcodeTimeoutRef.current) clearTimeout(transcodeTimeoutRef.current);
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      if (gestureTimeoutRef.current) clearTimeout(gestureTimeoutRef.current);
      if (introTimerRef.current) clearTimeout(introTimerRef.current);
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close().catch(() => {});
        } catch (_) {}
        audioCtxRef.current = null;
      }
    };
  }, []);

  // Listen to fullscreen changes across browsers
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(isFs);
      if (isFs) {
        revealControls(3000);
        try {
          if (screen.orientation && typeof screen.orientation.lock === 'function') {
            screen.orientation.lock('landscape').catch(() => {});
          }
        } catch (_) {}
      } else {
        try {
          if (screen.orientation && typeof screen.orientation.unlock === 'function') {
            screen.orientation.unlock();
          }
        } catch (_) {}
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Picture-in-Picture event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnterPiP = () => setIsPiP(true);
    const handleLeavePiP = () => setIsPiP(false);

    video.addEventListener('enterpictureinpicture', handleEnterPiP);
    video.addEventListener('leavepictureinpicture', handleLeavePiP);
    return () => {
      video.removeEventListener('enterpictureinpicture', handleEnterPiP);
      video.removeEventListener('leavepictureinpicture', handleLeavePiP);
    };
  }, [playingItem]);

  // Auto-hide controls scheduler
  const scheduleControlsHide = useCallback((delayMs = 3000) => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }

    controlsTimeoutRef.current = setTimeout(() => {
      const isPaused = videoRef.current ? videoRef.current.paused : !isPlayingRef.current;
      if (!isPaused && !menusOpenRef.current && !isScrubbingRef.current) {
        setShowControls(false);
        showControlsRef.current = false;
        setQualityMenuOpen(false);
        setAudioMenuOpen(false);
        setSubMenuOpen(false);
        setSpeedMenuOpen(false);
      }
    }, delayMs);
  }, []);

  const revealControls = useCallback((delayMs = 3000) => {
    setShowControls(true);
    showControlsRef.current = true;
    scheduleControlsHide(delayMs);
  }, [scheduleControlsHide]);

  // Construct Stream URL based on Quality, HDR Mode, Selected Audio Track, and Start Position
  const getStreamUrl = useCallback((qual, hdr, audTrack, startPos) => {
    if (!playingItem) return '';
    const params = new URLSearchParams({
      quality: qual,
      hdr: hdr,
      start: Math.floor(startPos ?? 0)
    });
    if (playingItem.episodeId) params.append('episodeId', playingItem.episodeId);
    if (audTrack !== null && audTrack !== undefined) params.append('audioTrack', audTrack);
    return `/api/stream/hls/${playingItem.mediaId || playingItem.id}/master.m3u8?${params.toString()}`;
  }, [playingItem]);

  // Fallback Direct Play Stream URL
  const getDirectStreamUrl = useCallback(() => {
    if (!playingItem) return '';
    const target = playingItem.episodeId || playingItem.mediaId || playingItem.id;
    const epQuery = playingItem.episodeId ? `?episodeId=${playingItem.episodeId}` : '';
    return `/api/stream/direct/${target}${epQuery}`;
  }, [playingItem]);

  // Initialize and load stream
  const initializeStream = useCallback((overrideQuality, overrideHdr, startPos) => {
    const video = videoRef.current;
    if (!video || !playingItem) return;

    const currentQ = overrideQuality || quality;
    const currentH = overrideHdr || hdrMode;
    const seekTime = (startPos !== undefined && startPos !== null)
      ? startPos
      : (currentTimeRef.current || playingItem.startPosition || 0);

    streamOffsetRef.current = isDirectFileMode ? 0 : seekTime;
    setCurrentTime(seekTime);

    setIsLoading(true);
    setErrorMessage(null);
    setErrorDetails('');
    setIsTranscodeSlow(false);

    if (transcodeTimeoutRef.current) clearTimeout(transcodeTimeoutRef.current);
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);

    // Watchdog for slow transcode / buffer stall (12 seconds)
    transcodeTimeoutRef.current = setTimeout(() => {
      if (video && video.readyState < 2) {
        setIsTranscodeSlow(true);
      }
    }, 12000);

    const streamUrl = getStreamUrl(currentQ, currentH, selectedAudioTrack, seekTime);
    console.log(`[NovaPlayer] Mounting stream with Cache API loader: ${streamUrl}`);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        fLoader: CachedFragmentLoader,
        debug: false,
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        maxBufferSize: 150 * 1000 * 1000,
        maxBufferHole: 0.5,
        startFragPrefetch: true,
        progressive: true,
        liveSyncDurationCount: 15,
        liveMaxLatencyDurationCount: 30,
        highBufferWatchdogPeriod: 2,
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 20000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1000,
        fragLoadingTimeOut: 30000,
        fragLoadingMaxRetry: 5,
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 64000
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        setIsTranscodeSlow(false);
        retryAttemptRef.current = 0;
        mediaErrorCountRef.current = 0;
        setReconnectToast(null);

        video.playbackRate = playbackSpeed;

        video.play().then(() => {
          setIsPlaying(true);
          revealControls(2500);
        }).catch((err) => {
          console.warn('[NovaPlayer] Autoplay prevented or waiting for interaction:', err?.message);
          setIsPlaying(false);
          setShowControls(true);
        });
      });

      // Synchronize playhead once media chunk is actually buffered in MSE
      if (seekTime > 0) {
        const seekSafetyTimer = setTimeout(() => {
          isSeekingRef.current = false;
        }, 15000);

        hls.once(Hls.Events.FRAG_BUFFERED, () => {
          clearTimeout(seekSafetyTimer);
          isSeekingRef.current = false;
          if (videoRef.current) {
            videoRef.current.play().catch(() => {});
          }
        });
      } else {
        isSeekingRef.current = false;
      }

      // Robust Error Handling & Exponential Backoff Auto-Recovery
      hls.on(Hls.Events.ERROR, (event, data) => {
        console.warn('[NovaPlayer] HLS event error:', data.type, data.details, data.fatal);

        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR: {
              const attempt = retryAttemptRef.current + 1;
              retryAttemptRef.current = attempt;

              if (attempt <= 3) {
                const backoffMs = attempt === 1 ? 1200 : attempt === 2 ? 2500 : 5000;
                setReconnectToast(`Reconnecting stream (attempt ${attempt} of 3)...`);
                setIsLoading(true);

                if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
                retryTimeoutRef.current = setTimeout(() => {
                  console.log(`[NovaPlayer] Auto-retry network attempt #${attempt}...`);
                  if (data.details === 'manifestLoadError' || data.details === 'manifestLoadTimeOut') {
                    hls.loadSource(streamUrl);
                  }
                  hls.startLoad();
                }, backoffMs);
              } else {
                hls.destroy();
                setIsLoading(false);
                setReconnectToast(null);
                setErrorMessage('Network connection to transcode stream lost.');
                setErrorDetails('The media server transcode pipeline was interrupted or is experiencing high load.');
              }
              break;
            }

            case Hls.ErrorTypes.MEDIA_ERROR: {
              mediaErrorCountRef.current += 1;
              console.log(`[NovaPlayer] Attempting media error recovery (count: ${mediaErrorCountRef.current})...`);

              if (mediaErrorCountRef.current === 1) {
                hls.recoverMediaError();
              } else if (mediaErrorCountRef.current === 2) {
                hls.swapAudioCodec();
                hls.recoverMediaError();
              } else {
                hls.destroy();
                setIsLoading(false);
                setErrorMessage('Codec decoding issue encountered.');
                setErrorDetails('The video codec or bitstream format cannot be decoded natively in this profile.');
              }
              break;
            }

            default: {
              console.error('[NovaPlayer] Fatal unrecoverable HLS error:', data.details);
              hls.destroy();
              setIsLoading(false);
              setErrorMessage('Playback stream disrupted.');
              setErrorDetails(data.details || 'An unexpected streaming error occurred.');
              break;
            }
          }
        }
      });

      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Apple Safari / iOS HLS
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        setIsLoading(false);
        setIsTranscodeSlow(false);
        if (seekTime > 0) video.currentTime = seekTime;
        video.playbackRate = playbackSpeed;
        video.play().then(() => {
          setIsPlaying(true);
          revealControls(2500);
        }).catch(() => setIsPlaying(false));
      }, { once: true });
    } else {
      // Direct file fallback
      video.src = streamUrl;
      video.playbackRate = playbackSpeed;
      video.play().then(() => {
        setIsPlaying(true);
        setIsLoading(false);
        revealControls(2500);
      }).catch(() => setIsPlaying(false));
    }
  }, [playingItem, quality, hdrMode, selectedAudioTrack, playbackSpeed, getStreamUrl, revealControls]);

  // Load stream on mount or when core media props change
  useEffect(() => {
    if (!playingItem) return;
    if (isDirectFileMode) return; // In manual direct mode, don't re-initialize HLS

    const mediaKey = `${playingItem.mediaId || playingItem.id}_${playingItem.episodeId || ''}`;
    const isSameMedia = lastMediaKeyRef.current === mediaKey;

    if (isSameMedia) {
      // Seamless quality/HDR/audio switch: preserve current time position!
      const resumePos = videoRef.current?.currentTime || currentTimeRef.current || 0;
      initializeStream(quality, hdrMode, resumePos);
    } else {
      // Fresh media opened: start from beginning or saved start position
      lastMediaKeyRef.current = mediaKey;
      initializeStream(quality, hdrMode, playingItem.startPosition || 0);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (transcodeTimeoutRef.current) clearTimeout(transcodeTimeoutRef.current);
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, [playingItem?.id, playingItem?.episodeId, quality, hdrMode, selectedAudioTrack, isDirectFileMode]);

  // Apply playback speed changes to video
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  const handleSeeked = () => {
    isSeekingRef.current = false;
    if (videoRef.current) {
      const streamOffset = isDirectFileMode ? 0 : streamOffsetRef.current;
      setCurrentTime(streamOffset + videoRef.current.currentTime);
    }
  };

  // Video element events
  const handleTimeUpdate = () => {
    if (!videoRef.current || !playingItem) return;
    const v = videoRef.current;
    const streamOffset = isDirectFileMode ? 0 : streamOffsetRef.current;
    const cur = streamOffset + v.currentTime;
    const total = authoritativeDuration;

    if (!isScrubbingRef.current && !isSeekingRef.current) {
      setCurrentTime(cur);
      if (total > 0 && total !== duration) {
        setDuration(total);
      }
      updateProgress(cur, total);
    }

    // Calculate buffered range accurately with stream offset
    if (v.buffered && v.buffered.length > 0) {
      const b = v.buffered;
      let activeRange = { start: streamOffset + b.start(0), end: streamOffset + b.end(b.length - 1) };
      for (let i = 0; i < b.length; i++) {
        if (v.currentTime >= b.start(i) - 1 && v.currentTime <= b.end(i) + 1) {
          activeRange = { start: streamOffset + b.start(i), end: streamOffset + b.end(i) };
          break;
        }
      }
      setBufferedRange(activeRange);
      setBufferedEnd(activeRange.end);
    }

    // Binge Mode: Show Next Episode countdown during last 25 seconds of TV shows
    const isShow = playingItem.type === 'show';
    if (isShow && total > 60 && total - cur <= 25 && total - cur > 0) {
      setNextEpisodeCountdown(Math.ceil(total - cur));
    } else {
      setNextEpisodeCountdown(null);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
        setIsLoading(false);
        revealControls(2500);
      }).catch(err => {
        console.warn('Playback blocked:', err);
      });
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
      setShowControls(true);
      showControlsRef.current = true;
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    }
  };

  const formatTimeWithSubseconds = (secs) => {
    if (isNaN(secs) || secs < 0) return '00:00.0';
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    const pad = (n) => String(n).padStart(2, '0');
    return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(s)}.${ms}` : `${pad(mins)}:${pad(s)}.${ms}`;
  };

  const parseTimestamp = (input) => {
    if (!input) return null;
    const str = input.trim();
    if (/^\d+(\.\d+)?$/.test(str)) {
      return parseFloat(str);
    }
    const parts = str.split(':').map(p => parseFloat(p));
    if (parts.some(p => isNaN(p) || p < 0)) return null;
    if (parts.length === 3) {
      return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    }
    if (parts.length === 2) {
      return (parts[0] * 60) + parts[1];
    }
    return null;
  };

  const triggerSeekFeedback = (type, text, targetTime) => {
    if (seekFeedbackTimeoutRef.current) clearTimeout(seekFeedbackTimeoutRef.current);
    setSeekFeedback({
      id: Date.now() + Math.random(),
      type,
      text,
      targetTime: targetTime !== undefined ? targetTime : (videoRef.current?.currentTime || 0)
    });
    seekFeedbackTimeoutRef.current = setTimeout(() => {
      setSeekFeedback(null);
      accumulatedSkipRef.current = 0;
      lastSkipDirectionRef.current = null;
    }, 900);
  };

  const seekRelative = (seconds) => {
    if (!videoRef.current) return;
    const direction = seconds < 0 ? 'rewind' : 'forward';

    if (lastSkipDirectionRef.current === direction) {
      accumulatedSkipRef.current += seconds;
    } else {
      accumulatedSkipRef.current = seconds;
      lastSkipDirectionRef.current = direction;
    }

    const maxDur = authoritativeDuration || (videoRef.current ? videoRef.current.duration : 0) || 0;
    const streamOffset = isDirectFileMode ? 0 : streamOffsetRef.current;
    const cur = streamOffset + (videoRef.current ? videoRef.current.currentTime : currentTime);
    const targetTime = Math.max(0, Math.min(maxDur, cur + seconds));

    commitSeek(targetTime);

    const totalSeconds = Math.abs(accumulatedSkipRef.current);
    triggerSeekFeedback(
      direction,
      `${direction === 'rewind' ? '-' : '+'}${totalSeconds}s`,
      targetTime
    );
    revealControls(3000);
  };

  const commitSeek = (targetTime) => {
    if (seekStallTimeoutRef.current) {
      clearTimeout(seekStallTimeoutRef.current);
      seekStallTimeoutRef.current = null;
    }

    const finalTime = Math.max(0, Math.min(displayDuration, targetTime));
    setCurrentTime(finalTime);
    setIsScrubbing(false);
    isScrubbingRef.current = false;

    const video = videoRef.current;
    if (!video) return;

    const streamOffset = isDirectFileMode ? 0 : streamOffsetRef.current;
    const localTarget = isDirectFileMode ? finalTime : (finalTime - streamOffset);

    // Check if target is already in the buffered segment range
    let isBuffered = false;
    if (video.buffered) {
      for (let i = 0; i < video.buffered.length; i++) {
        if (localTarget >= (video.buffered.start(i) - 0.5) && localTarget <= (video.buffered.end(i) + 0.5)) {
          isBuffered = true;
          break;
        }
      }
    }

    if (isBuffered || isDirectFileMode) {
      // Instant seek within buffered media or direct file stream
      isSeekingRef.current = true;
      video.currentTime = Math.max(0, localTarget);
      revealControls(2500);
    } else {
      // Seek outside buffer in HLS mode:
      // Immediately request a fresh transcode stream at the target timestamp.
      isSeekingRef.current = true;
      setIsLoading(true);
      console.log(`[NovaPlayer] Seek to ${finalTime.toFixed(1)}s outside buffer -> starting session at ${finalTime.toFixed(1)}s`);
      initializeStream(quality, hdrMode, finalTime);
    }

    revealControls(3500);
  };

  const showGestureHUD = useCallback((type, value, percent = null) => {
    setGestureIndicator({ type, value, percent });
    if (gestureTimeoutRef.current) clearTimeout(gestureTimeoutRef.current);
    gestureTimeoutRef.current = setTimeout(() => {
      setGestureIndicator(null);
    }, 1200);
  }, []);

  const cycleAspectRatio = useCallback(() => {
    setAspectRatioMode(prev => {
      let next = 'contain';
      let label = 'Fit (Contain)';
      if (prev === 'contain') {
        next = 'cover';
        label = 'Fill (Crop)';
      } else if (prev === 'cover') {
        next = 'fill';
        label = 'Stretch (Fill)';
      } else {
        next = 'contain';
        label = 'Fit (Contain)';
      }
      showGestureHUD('aspect', `Aspect Ratio: ${label}`);
      return next;
    });
  }, [showGestureHUD]);

  const toggleSpeechClarity = useCallback(() => {
    setSpeechClarity(prev => {
      const next = !prev;
      try {
        if (!audioCtxRef.current && videoRef.current) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) {
            const ctx = new AudioContextClass();
            audioCtxRef.current = ctx;

            const source = ctx.createMediaElementSource(videoRef.current);
            sourceNodeRef.current = source;

            const hp = ctx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = next ? 85 : 0;
            highpassRef.current = hp;

            const peak = ctx.createBiquadFilter();
            peak.type = 'peaking';
            peak.frequency.value = 2200;
            peak.Q.value = 1.4;
            peak.gain.value = next ? 6.5 : 0;
            speechFilterRef.current = peak;

            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = next ? -24 : 0;
            comp.knee.value = 30;
            comp.ratio.value = next ? 10 : 1;
            comp.attack.value = 0.003;
            comp.release.value = 0.25;
            compressorRef.current = comp;

            source.connect(hp);
            hp.connect(peak);
            peak.connect(comp);
            comp.connect(ctx.destination);
          }
        } else if (audioCtxRef.current) {
          if (audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume().catch(() => {});
          }
          if (highpassRef.current) {
            highpassRef.current.frequency.value = next ? 85 : 0;
          }
          if (speechFilterRef.current) {
            speechFilterRef.current.gain.value = next ? 6.5 : 0;
          }
          if (compressorRef.current) {
            compressorRef.current.threshold.value = next ? -24 : 0;
            compressorRef.current.ratio.value = next ? 10 : 1;
          }
        }
      } catch (e) {
        console.warn('[WebAudio] Dialogue enhancement error:', e);
      }

      showGestureHUD('clarity', next ? 'Speech Clarity: ON' : 'Speech Clarity: OFF');
      return next;
    });
  }, [showGestureHUD]);

  const jumpToPreviousChapter = useCallback(() => {
    if (!chapters || chapters.length === 0) {
      seekRelative(-30);
      return;
    }
    const current = currentTimeRef.current;
    const curIdx = chapters.findIndex(c => current >= getChapStart(c) && current < getChapEnd(c));
    if (curIdx >= 0) {
      if (current - getChapStart(chapters[curIdx]) > 3 || curIdx === 0) {
        commitSeek(getChapStart(chapters[curIdx]));
        showGestureHUD('chapter', chapters[curIdx].title);
      } else if (curIdx > 0) {
        commitSeek(getChapStart(chapters[curIdx - 1]));
        showGestureHUD('chapter', chapters[curIdx - 1].title);
      }
    } else {
      const prevChaps = chapters.filter(c => getChapStart(c) < current);
      if (prevChaps.length > 0) {
        const target = prevChaps[prevChaps.length - 1];
        commitSeek(getChapStart(target));
        showGestureHUD('chapter', target.title);
      } else {
        commitSeek(0);
      }
    }
  }, [chapters, seekRelative, showGestureHUD]);

  const jumpToNextChapter = useCallback(() => {
    if (!chapters || chapters.length === 0) {
      seekRelative(30);
      return;
    }
    const current = currentTimeRef.current;
    const curIdx = chapters.findIndex(c => current >= getChapStart(c) && current < getChapEnd(c));
    if (curIdx >= 0 && curIdx < chapters.length - 1) {
      commitSeek(getChapStart(chapters[curIdx + 1]));
      showGestureHUD('chapter', chapters[curIdx + 1].title);
    } else if (curIdx < 0) {
      const nextChap = chapters.find(c => getChapStart(c) > current);
      if (nextChap) {
        commitSeek(getChapStart(nextChap));
        showGestureHUD('chapter', nextChap.title);
      } else {
        seekRelative(30);
      }
    } else {
      seekRelative(30);
    }
  }, [chapters, seekRelative, showGestureHUD]);

  const handleSkipIntro = useCallback((e) => {
    e?.stopPropagation();
    if (introTimerRef.current) {
      clearTimeout(introTimerRef.current);
      introTimerRef.current = null;
    }
    if (effectiveIntro) {
      commitSeek(effectiveIntro.end + 0.5);
      triggerSeekFeedback('forward', 'Skipped Intro', effectiveIntro.end + 0.5);
    }
    setIsIntroVisible(false);
    setIsIntroDismissed(true);
  }, [effectiveIntro, commitSeek, triggerSeekFeedback]);

  const handleDismissIntro = useCallback((e) => {
    e?.stopPropagation();
    if (introTimerRef.current) {
      clearTimeout(introTimerRef.current);
      introTimerRef.current = null;
    }
    setIsIntroVisible(false);
    setIsIntroDismissed(true);
  }, []);

  // Touch Drag Gestures for Brightness (Left half) and Volume (Right half) & Pinch Aspect
  const handleTouchStart = (e) => {
    if (e.target.closest('[data-interactive="true"]') || e.target.closest('button') || e.target.closest('input')) {
      return;
    }

    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStateRef.current = {
        mode: 'pinch',
        initialPinchDist: dist,
        hasMoved: false
      };
      return;
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const rect = containerRef.current?.getBoundingClientRect();
      const screenWidth = rect?.width || window.innerWidth || 1000;
      const isLeft = touch.clientX < screenWidth * 0.5;

      touchStateRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        mode: isLeft ? 'brightness' : 'volume',
        startBrightness: brightness,
        startVolume: volume,
        hasMoved: false
      };
    }
  };

  const handleTouchMove = (e) => {
    const state = touchStateRef.current;
    if (!state.mode) return;

    if (state.mode === 'pinch' && e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (Math.abs(dist - state.initialPinchDist) > 50 && !state.hasMoved) {
        state.hasMoved = true;
        cycleAspectRatio();
      }
      return;
    }

    if (e.touches.length === 1 && (state.mode === 'brightness' || state.mode === 'volume')) {
      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - state.startX);
      const deltaY = state.startY - touch.clientY;
      const rect = containerRef.current?.getBoundingClientRect();
      const screenHeight = rect?.height || window.innerHeight || 600;

      if ((Math.abs(deltaY) > 10 && Math.abs(deltaY) > deltaX) || state.hasMoved) {
        state.hasMoved = true;

        if (state.mode === 'brightness') {
          const deltaB = (deltaY / screenHeight) * 1.3;
          const newB = Math.min(1.5, Math.max(0.2, parseFloat((state.startBrightness + deltaB).toFixed(2))));
          setBrightness(newB);
          const pct = Math.round(((newB - 0.2) / 1.3) * 100);
          showGestureHUD('brightness', `${pct}%`, pct);
        } else if (state.mode === 'volume') {
          const deltaV = (deltaY / screenHeight);
          const newV = Math.min(1.0, Math.max(0, parseFloat((state.startVolume + deltaV).toFixed(2))));
          setVolume(newV);
          if (videoRef.current) videoRef.current.volume = newV;
          setIsMuted(newV === 0);
          const pct = Math.round(newV * 100);
          showGestureHUD('volume', `${pct}%`, pct);
        }
      }
    }
  };

  const handleTouchEnd = () => {
    touchStateRef.current.mode = null;
    if (gestureTimeoutRef.current) clearTimeout(gestureTimeoutRef.current);
    gestureTimeoutRef.current = setTimeout(() => {
      setGestureIndicator(null);
    }, 1200);
    setTimeout(() => {
      if (touchStateRef.current) touchStateRef.current.hasMoved = false;
    }, 300);
  };

  // Native MediaSession API Integration
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator) || !playingItem) return;

    const title = playingItem.episodeTitle
      ? `${playingItem.episodeNumber ? `E${playingItem.episodeNumber}: ` : ''}${playingItem.title}`
      : (playingItem.title || 'NovaPlex Media');
    const artist = playingItem.showTitle || playingItem.director || 'NovaPlex';
    const album = playingItem.seasonNumber
      ? `Season ${playingItem.seasonNumber}`
      : (playingItem.release_year ? `${playingItem.release_year}` : 'Movie');

    const toAbsoluteUrl = (url) => {
      try {
        return new URL(url, window.location.origin).href;
      } catch (_) {
        return url;
      }
    };

    const artwork = [];
    const bdrop = playingItem.backdropUrl || playingItem.backdrop_url;
    const pster = playingItem.posterUrl || playingItem.poster_url;
    if (bdrop) {
      artwork.push({ src: toAbsoluteUrl(bdrop), sizes: '1920x1080', type: 'image/jpeg' });
    }
    if (pster) {
      artwork.push({ src: toAbsoluteUrl(pster), sizes: '512x512', type: 'image/jpeg' });
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork
      });

      navigator.mediaSession.setActionHandler('play', () => {
        videoRef.current?.play().catch(() => {});
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        videoRef.current?.pause();
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        seekRelative(details?.seekOffset || 10);
      });
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        seekRelative(-(details?.seekOffset || 10));
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details?.seekTime !== undefined && videoRef.current) {
          commitSeek(details.seekTime);
        }
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        jumpToPreviousChapter();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        jumpToNextChapter();
      });
    } catch (err) {
      console.warn('[MediaSession] Handler error:', err);
    }

    return () => {
      try {
        const actions = ['play', 'pause', 'seekforward', 'seekbackward', 'seekto', 'previoustrack', 'nexttrack'];
        actions.forEach(act => {
          try {
            navigator.mediaSession.setActionHandler(act, null);
          } catch (_) {}
        });
      } catch (_) {}
    };
  }, [playingItem, seekRelative, jumpToPreviousChapter, jumpToNextChapter]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      if (displayDuration > 0 && typeof navigator.mediaSession.setPositionState === 'function') {
        navigator.mediaSession.setPositionState({
          duration: Math.max(0, displayDuration),
          playbackRate: playbackSpeed || 1.0,
          position: Math.min(displayDuration, Math.max(0, currentTime))
        });
      }
    } catch (_) {}
  }, [isPlaying, currentTime, displayDuration, playbackSpeed]);

  // Synchronize HTML5 video textTracks display mode
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (selectedSubtitleTrack >= 0) {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = 'showing';
        }
      } else {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = 'disabled';
        }
      }
    } catch (_) {}
  }, [selectedSubtitleTrack, subtitleOffset]);

  // Scrubber user interactions with Pointer Capture for fine-grained scrubbing
  const handleScrubberPointerDown = (e) => {
    e.preventDefault();
    isScrubbingRef.current = true;
    setIsScrubbing(true);
    if (e.currentTarget.setPointerCapture) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (_) {}
    }

    const rect = scrubberContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = percent * displayDuration;
    setScrubTime(target);
    setHoverPosition({ percent: percent * 100, time: target });
  };

  const handleScrubberPointerMove = (e) => {
    const rect = scrubberContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = percent * displayDuration;

    setHoverPosition({ percent: percent * 100, time: target });

    if (isScrubbingRef.current) {
      setScrubTime(target);
    }
  };

  const handleScrubberPointerUp = (e) => {
    const wasScrubbing = isScrubbingRef.current;
    if (e.currentTarget.releasePointerCapture) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }
    isScrubbingRef.current = false;
    setIsScrubbing(false);

    if (wasScrubbing) {
      const rect = scrubberContainerRef.current?.getBoundingClientRect();
      const percent = rect ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0;
      const target = percent * displayDuration;
      commitSeek(target);
    }
  };

  const handleScrubberMouseLeave = () => {
    if (!isScrubbingRef.current) {
      setHoverPosition(null);
    }
  };

  // Wheel scrubbing on playbar (Prevents browser 5s jump, enables smooth 1s or 0.1s scrubbing!)
  const handleScrubberWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    // Normal wheel: ±1.0s
    // Shift key: ±0.1s (precision frame step)
    // Alt/Ctrl: ±5.0s
    const step = e.shiftKey ? 0.1 : (e.altKey || e.ctrlKey ? 5.0 : 1.0);
    const direction = (e.deltaY < 0 || e.deltaX > 0) ? 1 : -1;
    const maxDur = authoritativeDuration || (videoRef.current?.duration) || 0;
    const base = isScrubbing ? scrubTime : (videoRef.current?.currentTime || currentTime);
    const target = Math.max(0, Math.min(maxDur, parseFloat((base + (direction * step)).toFixed(2))));

    setScrubTime(target);
    setIsScrubbing(true);

    if (wheelCommitTimeoutRef.current) clearTimeout(wheelCommitTimeoutRef.current);
    wheelCommitTimeoutRef.current = setTimeout(() => {
      commitSeek(target);
    }, 220);

    triggerSeekFeedback(
      direction > 0 ? 'forward' : 'rewind',
      `${formatTimeWithSubseconds(target)} (${direction > 0 ? '+' : ''}${(direction * step).toFixed(1)}s)`,
      target
    );
    revealControls(3000);
  }, [authoritativeDuration, currentTime, isScrubbing, scrubTime, displayDuration]);

  // Attach non-passive wheel event listener to playbar container
  useEffect(() => {
    const el = scrubberContainerRef.current;
    if (!el) return;
    const onWheel = (e) => handleScrubberWheel(e);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelCommitTimeoutRef.current) clearTimeout(wheelCommitTimeoutRef.current);
    };
  }, [handleScrubberWheel]);

  // Stats for Nerds live diagnostics updater (every 400ms when HUD is active)
  useEffect(() => {
    if (!showStatsForNerds || !playingItem) return;

    const updateNerdData = () => {
      const video = videoRef.current;
      if (!video) return;

      const rect = video.getBoundingClientRect();
      const viewport = `${Math.round(rect.width)}x${Math.round(rect.height)} (${(window.devicePixelRatio || 1).toFixed(1)}x DPR)`;
      const optimalRes = `${video.videoWidth || 1920}x${video.videoHeight || 1080}`;

      let totalFrames = 0;
      let droppedFrames = 0;
      let dropRate = '0.00%';
      if (typeof video.getVideoPlaybackQuality === 'function') {
        const q = video.getVideoPlaybackQuality();
        totalFrames = q.totalVideoFrames || 0;
        droppedFrames = q.droppedVideoFrames || 0;
        if (totalFrames > 0) {
          dropRate = `${((droppedFrames / totalFrames) * 100).toFixed(2)}%`;
        }
      } else if (video.webkitDecodedFrameCount !== undefined) {
        totalFrames = video.webkitDecodedFrameCount || 0;
        droppedFrames = video.webkitDroppedFrameCount || 0;
        if (totalFrames > 0) {
          dropRate = `${((droppedFrames / totalFrames) * 100).toFixed(2)}%`;
        }
      }

      let bufferAhead = 0;
      if (video.buffered) {
        for (let i = 0; i < video.buffered.length; i++) {
          if (video.currentTime >= (video.buffered.start(i) - 0.25) && video.currentTime <= (video.buffered.end(i) + 0.25)) {
            bufferAhead = Math.max(0, video.buffered.end(i) - video.currentTime);
            break;
          }
        }
      }

      let audioLabel = 'Default Audio';
      if (audioTracks.length > 0) {
        const currentAud = audioTracks.find(a => a.stream_index === selectedAudioTrack) || audioTracks[0];
        audioLabel = currentAud.title || `Track (${currentAud.language || 'und'}) - ${currentAud.codec || 'AAC'}`;
      }

      const estBandwidth = hlsRef.current?.bandwidthEstimate
        ? `${(hlsRef.current.bandwidthEstimate / 1000000).toFixed(2)} Mbps`
        : 'Native Passthrough';

      const qualObj = QUALITIES.find(q => q.id === quality);
      const streamModeStr = isDirectFileMode
        ? 'Direct Native HTTP 206'
        : (quality === 'direct' ? 'HLS Bit-for-Bit Remux' : `HLS Adaptive (${quality.toUpperCase()})`);

      const hdrStatusStr = hdrMode === 'on'
        ? 'HDR10+ Passthrough (SMPTE ST 2084)'
        : 'SDR Hable Tonemapped (Rec.709)';

      const targetId = playingItem.episodeId || playingItem.mediaId || playingItem.id;
      const cacheHits = typeof window !== 'undefined' ? (window.__novaplex_cache_hits || 0) : 0;
      const cacheStored = typeof window !== 'undefined' ? (window.__novaplex_cache_stored || 0) : 0;
      const clientCacheStr = `Active (${cacheHits} hits / ${cacheStored} cached)`;

      setNerdStats({
        viewport,
        optimalRes,
        totalFrames,
        droppedFrames,
        dropRate,
        bufferHealth: `${bufferAhead.toFixed(2)}s`,
        bufferAheadSecs: bufferAhead,
        videoCodec: playingItem.video_codec ? playingItem.video_codec.toUpperCase() : 'H.264 / AVC',
        audioCodec: audioLabel,
        streamMode: streamModeStr,
        hdrStatus: hdrStatusStr,
        bitrate: qualObj?.desc || '65 Mbps Master',
        bandwidth: estBandwidth,
        playhead: formatTimeWithSubseconds(video.currentTime),
        duration: formatTimeWithSubseconds(displayDuration),
        sessionKey: `${targetId}_${quality}_ss${Math.floor(currentTimeRef.current || 0)}`,
        clientCache: clientCacheStr
      });
    };

    updateNerdData();
    const interval = setInterval(updateNerdData, 400);
    return () => clearInterval(interval);
  }, [showStatsForNerds, playingItem, quality, hdrMode, selectedAudioTrack, audioTracks, isDirectFileMode, displayDuration]);

  const copyNerdStats = () => {
    const text = JSON.stringify(nerdStats, null, 2);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedStats(true);
        setTimeout(() => setCopiedStats(false), 2000);
      }).catch(() => {});
    }
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (!isFs) {
      try {
        if (containerRef.current.requestFullscreen) {
          await containerRef.current.requestFullscreen();
        } else if (containerRef.current.webkitRequestFullscreen) {
          containerRef.current.webkitRequestFullscreen();
        } else if (videoRef.current?.webkitEnterFullscreen) {
          videoRef.current.webkitEnterFullscreen();
        }
      } catch (err) {
        console.warn('Fullscreen request failed:', err);
      }
      // Lock orientation to landscape mode on mobile/handheld devices
      try {
        if (screen.orientation && typeof screen.orientation.lock === 'function') {
          await screen.orientation.lock('landscape');
        }
      } catch (err) {
        try {
          if (screen.orientation?.lock) {
            await screen.orientation.lock('landscape-primary');
          }
        } catch (_) {}
      }
      setIsFullscreen(true);
      revealControls(3500);
    } else {
      try {
        if (screen.orientation && typeof screen.orientation.unlock === 'function') {
          screen.orientation.unlock();
        }
      } catch (_) {}
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      } catch (err) {
        console.warn('Fullscreen exit failed:', err);
      }
      setIsFullscreen(false);
      revealControls(3500);
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPiP(false);
      } else if (videoRef.current.requestPictureInPicture) {
        await videoRef.current.requestPictureInPicture();
        setIsPiP(true);
      }
    } catch (err) {
      console.warn('Picture-in-Picture error:', err);
    }
  };

  // Background tap/click handling with YouTube/Netflix-style double-tap zones
  const handleBackgroundTap = (clientX, clientY, target) => {
    if (target?.closest?.('button, input, select, [data-interactive="true"]')) {
      return;
    }

    if (showStatsForNerds || isJumpModalOpen) {
      setShowStatsForNerds(false);
      setIsJumpModalOpen(false);
      return;
    }

    const now = Date.now();
    const timeDelta = now - tapHistoryRef.current.time;
    const distX = Math.abs(clientX - tapHistoryRef.current.x);
    const distY = Math.abs(clientY - tapHistoryRef.current.y);

    // Double-tap detected: within 320ms and within 70px
    if (timeDelta < 320 && distX < 70 && distY < 70) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      tapHistoryRef.current = { time: 0, x: 0, y: 0 };

      const rect = containerRef.current?.getBoundingClientRect();
      const screenWidth = rect?.width || window.innerWidth || 1000;
      const relX = rect ? (clientX - rect.left) : clientX;
      const xRatio = relX / screenWidth;

      if (xRatio > 0.55) {
        // Double tap right: forward 10s
        seekRelative(10);
      } else if (xRatio < 0.45) {
        // Double tap left: rewind 10s
        seekRelative(-10);
      } else {
        // Double tap center: toggle play/pause
        togglePlay();
      }
      return;
    }

    // Schedule single tap action
    tapHistoryRef.current = { time: now, x: clientX, y: clientY };
    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);

    singleTapTimerRef.current = setTimeout(() => {
      if (showControlsRef.current) {
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current);
          controlsTimeoutRef.current = null;
        }
        setShowControls(false);
        showControlsRef.current = false;
        setQualityMenuOpen(false);
        setAudioMenuOpen(false);
        setSubMenuOpen(false);
        setSpeedMenuOpen(false);
        setIsMobileSettingsOpen(false);
      } else {
        revealControls(3500);
      }
      singleTapTimerRef.current = null;
    }, 240);
  };

  const handleContainerClick = (e) => {
    if (touchStateRef.current?.hasMoved) return;
    handleBackgroundTap(e.clientX, e.clientY, e.target);
  };

  const handleDoubleClick = (e) => {
    e.preventDefault();
  };

  const formatTime = (secs) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const pad = (n) => String(n).padStart(2, '0');
    return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(s)}` : `${pad(mins)}:${pad(s)}`;
  };

  // Recovery Actions
  const reloadStream = () => {
    setIsDirectFileMode(false);
    initializeStream(quality, hdrMode, currentTime);
  };

  const fallbackTo1080p = () => {
    setIsDirectFileMode(false);
    setQuality('1080p');
    initializeStream('1080p', hdrMode, currentTime);
  };

  const fallbackToDirect = () => {
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setErrorMessage(null);
    setIsLoading(true);
    setIsDirectFileMode(true);
    setQuality('direct');

    const directUrl = getDirectStreamUrl();
    console.log('[NovaPlayer] Falling back directly to MP4 stream:', directUrl);
    video.src = directUrl;
    if (currentTime > 0) video.currentTime = currentTime;
    video.play().then(() => {
      setIsPlaying(true);
      setIsLoading(false);
      revealControls(2500);
    }).catch(err => {
      console.warn('Direct fallback failed:', err);
      setErrorMessage('Direct Play unsupported on this client browser.');
      setErrorDetails('The file container or codec requires server-side transcoding.');
    });
  };

  // Keyboard Navigation
  useEffect(() => {
    if (!playingItem) return;

    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) {
          seekRelative(-1);
        } else {
          seekRelative(-10);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) {
          seekRelative(1);
        } else {
          seekRelative(10);
        }
      } else if (e.key === 'j') {
        seekRelative(-10);
      } else if (e.key === 'l') {
        seekRelative(10);
      } else if (e.key === '[') {
        e.preventDefault();
        jumpToPreviousChapter();
      } else if (e.key === ']') {
        e.preventDefault();
        jumpToNextChapter();
      } else if (e.key === 'a' || e.key === 'A') {
        cycleAspectRatio();
      } else if (e.key === 'c' || e.key === 'C') {
        toggleSpeechClarity();
      } else if (e.key === ',') {
        // Frame step backward (~0.042s)
        if (videoRef.current) {
          videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 0.042);
        }
      } else if (e.key === '.') {
        // Frame step forward (~0.042s)
        if (videoRef.current) {
          videoRef.current.currentTime = Math.min(displayDuration, videoRef.current.currentTime + 0.042);
        }
      } else if (e.key === 'n' || e.key === 'N') {
        setShowStatsForNerds(prev => !prev);
        revealControls(3500);
      } else if (e.key === 'g' || e.key === 'G') {
        setIsJumpModalOpen(prev => !prev);
        setJumpInputVal(formatTime(activeCurrentTime));
        setJumpInputError('');
        revealControls(4000);
      } else if (e.key === 'f') {
        toggleFullscreen();
      } else if (e.key === 's' || e.key === 'S') {
        if (effectiveIntro && activeCurrentTime >= effectiveIntro.start && activeCurrentTime <= effectiveIntro.end) {
          handleSkipIntro();
        }
      } else if (e.key === 'p') {
        togglePiP();
      } else if (e.key === 'm') {
        setIsMuted(prev => !prev);
      } else if (e.key === 'Escape') {
        if (showStatsForNerds) {
          setShowStatsForNerds(false);
        } else if (isJumpModalOpen) {
          setIsJumpModalOpen(false);
        } else if (isMobileSettingsOpen) {
          setIsMobileSettingsOpen(false);
        } else if (qualityMenuOpen || audioMenuOpen || subMenuOpen || speedMenuOpen) {
          setQualityMenuOpen(false);
          setAudioMenuOpen(false);
          setSubMenuOpen(false);
          setSpeedMenuOpen(false);
        } else {
          closePlayer();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setVolume(v => {
          const nv = Math.min(1, parseFloat((v + 0.1).toFixed(2)));
          if (videoRef.current) videoRef.current.volume = nv;
          setIsMuted(false);
          return nv;
        });
        revealControls(2500);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setVolume(v => {
          const nv = Math.max(0, parseFloat((v - 0.1).toFixed(2)));
          if (videoRef.current) videoRef.current.volume = nv;
          setIsMuted(nv === 0);
          return nv;
        });
        revealControls(2500);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playingItem, isPlaying, duration, authoritativeDuration, togglePlay, seekRelative, isMobileSettingsOpen, qualityMenuOpen, audioMenuOpen, subMenuOpen, speedMenuOpen, jumpToPreviousChapter, jumpToNextChapter, cycleAspectRatio, toggleSpeechClarity, effectiveIntro, activeCurrentTime, handleSkipIntro]);

  if (!playingItem) return null;

  const targetId = playingItem.episodeId || playingItem.mediaId || playingItem.id;

  return (
    <div
      ref={containerRef}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') revealControls(3000);
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onClick={handleContainerClick}
      onDoubleClick={handleDoubleClick}
      className={`fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden transition-all duration-300 ${
        !showControls && isPlaying ? 'cursor-none' : 'cursor-default'
      }`}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        className={`w-full h-full pointer-events-none transition-all duration-300 ${
          aspectRatioMode === 'cover'
            ? 'object-cover'
            : aspectRatioMode === 'fill'
            ? 'object-fill'
            : 'object-contain'
        }`}
        style={{
          filter: `brightness(${brightness})`
        }}
        onTimeUpdate={handleTimeUpdate}
        onSeeked={handleSeeked}
        onSeeking={() => { isSeekingRef.current = true; }}
        onPlay={() => {
          setIsPlaying(true);
          revealControls(2500);
        }}
        onPlaying={() => {
          setIsPlaying(true);
          setIsLoading(false);
          setIsTranscodeSlow(false);
          revealControls(2500);
        }}
        onPause={() => {
          setIsPlaying(false);
          setShowControls(true);
          showControlsRef.current = true;
          if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        }}
        onWaiting={() => setIsLoading(true)}
        onCanPlay={() => {
          setIsLoading(false);
          setIsTranscodeSlow(false);
        }}
        onError={() => {
          setIsLoading(false);
          const err = videoRef.current?.error;
          let desc = 'Video playback error.';
          if (err) {
            if (err.code === 1) desc = 'Playback aborted by user.';
            else if (err.code === 2) desc = 'Network error downloading stream.';
            else if (err.code === 3) desc = 'Decoding error — bitstream unsupported.';
            else if (err.code === 4) desc = 'Format or codec not supported natively.';
          }
          setErrorMessage(desc);
          setErrorDetails('Tap below to reload stream or fallback to a compatible transcode profile.');
        }}
        muted={isMuted}
        playsInline
        crossOrigin="anonymous"
      >
        {/* Active Subtitle Track */}
        {selectedSubtitleTrack >= 0 && (
          <track
            key={`${selectedSubtitleTrack}_${subtitleOffset}`}
            src={`/api/stream/subtitles/${targetId}/${selectedSubtitleTrack}.vtt?offset=${subtitleOffset}`}
            kind="subtitles"
            srcLang="en"
            label="Subtitles"
            default
            onLoad={(e) => {
              try {
                if (e.target?.track) {
                  e.target.track.mode = 'showing';
                }
              } catch (_) {}
            }}
          />
        )}
      </video>

      {/* Edge Touch Gesture HUD Indicator (Brightness / Volume / Aspect / Clarity / Chapter) */}
      {gestureIndicator && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none animate-in fade-in zoom-in-95 duration-150">
          <div className="px-6 py-4 rounded-3xl glass-pill bg-black/85 backdrop-blur-2xl border border-white/25 shadow-[0_20px_50px_rgba(0,0,0,0.85)] flex flex-col items-center gap-2 min-w-[140px] text-white">
            {gestureIndicator.type === 'brightness' && (
              <>
                <Sun className="w-8 h-8 text-amber-400 animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-wider text-white/70">Brightness</span>
                <span className="text-lg font-mono font-black text-amber-300">{gestureIndicator.value}</span>
                <div className="w-24 h-1.5 bg-white/20 rounded-full overflow-hidden mt-1">
                  <div
                    className="h-full bg-amber-400 rounded-full transition-all duration-75"
                    style={{ width: `${gestureIndicator.percent ?? 100}%` }}
                  />
                </div>
              </>
            )}
            {gestureIndicator.type === 'volume' && (
              <>
                {gestureIndicator.percent === 0 ? (
                  <VolumeX className="w-8 h-8 text-red-400" />
                ) : (
                  <Volume2 className="w-8 h-8 text-blue-400" />
                )}
                <span className="text-xs font-bold uppercase tracking-wider text-white/70">Volume</span>
                <span className="text-lg font-mono font-black text-blue-300">{gestureIndicator.value}</span>
                <div className="w-24 h-1.5 bg-white/20 rounded-full overflow-hidden mt-1">
                  <div
                    className="h-full bg-blue-400 rounded-full transition-all duration-75"
                    style={{ width: `${gestureIndicator.percent ?? 100}%` }}
                  />
                </div>
              </>
            )}
            {gestureIndicator.type === 'aspect' && (
              <>
                <Maximize className="w-8 h-8 text-purple-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-white/70">Aspect Ratio</span>
                <span className="text-base font-bold text-purple-300">{gestureIndicator.value}</span>
              </>
            )}
            {gestureIndicator.type === 'clarity' && (
              <>
                <Headphones className="w-8 h-8 text-emerald-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-white/70">Dialogue Clarity</span>
                <span className="text-base font-bold text-emerald-300">{gestureIndicator.value}</span>
              </>
            )}
            {gestureIndicator.type === 'chapter' && (
              <>
                <Bookmark className="w-8 h-8 text-cyan-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-white/70">Chapter</span>
                <span className="text-base font-bold text-cyan-300 text-center max-w-[220px] truncate">{gestureIndicator.value}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Seeking Visual Indicator Ripple (Peripheral Left/Right, Glitch-Free Liquid Glass) */}
      {seekFeedback && (
        <div
          key={seekFeedback.id}
          className={`absolute inset-y-0 ${
            seekFeedback.type === 'rewind'
              ? 'left-6 sm:left-16 justify-start'
              : 'right-6 sm:right-16 justify-end'
          } flex items-center pointer-events-none z-30`}
        >
          <div className={`px-4 sm:px-6 py-2.5 sm:py-3.5 rounded-2xl sm:rounded-3xl liquid-glass-btn bg-black/75 border border-white/30 backdrop-blur-3xl flex items-center gap-3 text-white shadow-[0_20px_50px_rgba(0,0,0,0.85)] ${
            seekFeedback.type === 'rewind' ? 'anim-vision-ripple-left' : 'anim-vision-ripple-right'
          }`}>
            <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 ${
              seekFeedback.type === 'rewind' ? 'bg-blue-500/25 text-blue-300' : 'bg-indigo-500/25 text-indigo-300'
            }`}>
              {seekFeedback.type === 'rewind' ? (
                <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
              ) : (
                <RotateCw className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-lg sm:text-xl font-black tracking-wider text-white">
                {seekFeedback.text}
              </span>
              <span className="text-[10px] font-mono text-white/70">
                {formatTimeWithSubseconds(seekFeedback.targetTime)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* VisionOS Stats for Nerds Stream HUD Overlay */}
      {showStatsForNerds && (
        <div
          data-interactive="true"
          className="absolute top-14 sm:top-18 left-3 sm:left-6 z-50 w-[92vw] max-w-sm sm:max-w-md p-4 sm:p-5 rounded-3xl glass-modal bg-[#0a0d14]/95 border border-white/25 backdrop-blur-3xl shadow-[0_30px_90px_rgba(0,0,0,0.95)] anim-vision-modal text-white select-text"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/15">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <h4 className="text-xs sm:text-sm font-bold tracking-wide uppercase flex items-center gap-1.5 text-white/90">
                <Activity className="w-4 h-4 text-emerald-400" /> Stats for Nerds
              </h4>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={copyNerdStats}
                className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer border border-white/10"
                title="Copy stream metrics to clipboard"
              >
                {copiedStats ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-white/70" />}
                <span>{copiedStats ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                onClick={() => setShowStatsForNerds(false)}
                className="p-1 rounded-full hover:bg-white/20 text-white/60 hover:text-white transition-colors cursor-pointer"
                title="Close (N / Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Live Diagnostics Content */}
          <div className="space-y-2.5 text-[11px] font-mono leading-relaxed max-h-[60vh] overflow-y-auto pr-1">
            {/* Resolution & Dimensions */}
            <div className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col gap-1">
              <div className="flex justify-between items-center text-white/50 text-[10px] uppercase font-bold tracking-wider">
                <span>Display & Viewport</span>
                <span className="text-emerald-400">Optimal</span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-white/60">Video Dimensions:</span>
                <span className="font-bold text-white">{nerdStats.optimalRes}</span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-white/60">Viewport Size:</span>
                <span className="text-white/80">{nerdStats.viewport}</span>
              </div>
            </div>

            {/* Dropped Frames & Playback Health */}
            <div className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col gap-1">
              <div className="flex justify-between items-center text-white/50 text-[10px] uppercase font-bold tracking-wider">
                <span>Decoder & Frame Drops</span>
                <span className={nerdStats.droppedFrames === 0 ? 'text-emerald-400' : 'text-amber-400'}>
                  {nerdStats.dropRate}
                </span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-white/60">Frames Decoded:</span>
                <span className="text-white">{nerdStats.totalFrames.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-white/60">Frames Dropped:</span>
                <span className={`font-bold ${nerdStats.droppedFrames > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                  {nerdStats.droppedFrames} ({nerdStats.dropRate})
                </span>
              </div>
            </div>

            {/* Buffer Health */}
            <div className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-white/50 text-[10px] uppercase font-bold tracking-wider">
                <span>Buffer Health</span>
                <span className="text-blue-400 font-bold">{nerdStats.bufferHealth}</span>
              </div>
              {/* Buffer Bar */}
              <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden relative">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    (nerdStats.bufferAheadSecs || 0) > 10
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                      : (nerdStats.bufferAheadSecs || 0) > 3
                      ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                      : 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]'
                  }`}
                  style={{ width: `${Math.min(100, ((nerdStats.bufferAheadSecs || 0) / 60) * 100)}%` }}
                />
              </div>
              <p className="text-[9px] text-white/40">Target Buffer: 60s • Auto-managed adaptive pipeline</p>
            </div>

            {/* Stream Codecs & Dynamic Range */}
            <div className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col gap-1">
              <div className="flex justify-between items-center text-white/50 text-[10px] uppercase font-bold tracking-wider">
                <span>Codecs & Pipeline</span>
                <span className="text-purple-300">{nerdStats.streamMode}</span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-white/60">Video Codec:</span>
                <span className="text-white">{nerdStats.videoCodec}</span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-white/60">Audio Codec:</span>
                <span className="text-white truncate max-w-[200px] text-right">{nerdStats.audioCodec}</span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-white/60">Dynamic Range:</span>
                <span className="text-amber-300 font-semibold">{nerdStats.hdrStatus}</span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-white/60">Profile Target:</span>
                <span className="text-white/80">{nerdStats.bitrate}</span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-white/60">Network Bandwidth:</span>
                <span className="text-white/80">{nerdStats.bandwidth}</span>
              </div>
            </div>

            {/* Playhead & Session */}
            <div className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col gap-1">
              <div className="flex justify-between items-center text-white/50 text-[10px] uppercase font-bold tracking-wider">
                <span>Playhead & Session</span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-white/60">Current Time:</span>
                <span className="font-bold text-blue-300">{nerdStats.playhead}</span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-white/60">Total Duration:</span>
                <span className="text-white">{nerdStats.duration}</span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-white/60">Transcode Key:</span>
                <span className="text-[10px] text-white/50 font-mono truncate max-w-[210px] text-right">{nerdStats.sessionKey}</span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-white/60">Client Cache:</span>
                <span className="text-[10px] text-emerald-400 font-bold truncate max-w-[210px] text-right">{nerdStats.clientCache}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VisionOS Jump to Particular Timestamp Modal */}
      {isJumpModalOpen && (
        <div
          data-interactive="true"
          className="absolute bottom-20 sm:bottom-24 left-4 sm:left-12 z-50 p-4 rounded-3xl glass-modal bg-[#0c101a]/95 border border-white/25 backdrop-blur-3xl shadow-[0_25px_60px_rgba(0,0,0,0.9)] w-80 anim-vision-modal select-text"
        >
          <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/10">
            <div className="flex items-center gap-1.5 text-xs font-bold text-white">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span>Go to Particular Timestamp</span>
            </div>
            <button
              onClick={() => setIsJumpModalOpen(false)}
              className="p-1 rounded-full text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = parseTimestamp(jumpInputVal);
              if (parsed === null) {
                setJumpInputError('Format: HH:MM:SS or MM:SS or seconds (e.g. 14:30)');
                return;
              }
              if (parsed > displayDuration) {
                setJumpInputError(`Exceeds duration (${formatTime(displayDuration)})`);
                return;
              }
              setIsJumpModalOpen(false);
              commitSeek(parsed);
              triggerSeekFeedback('forward', `Jump: ${formatTime(parsed)}`, parsed);
            }}
            className="space-y-3"
          >
            <div>
              <input
                type="text"
                value={jumpInputVal}
                onChange={(e) => {
                  setJumpInputVal(e.target.value);
                  setJumpInputError('');
                }}
                placeholder="e.g. 14:30 or 1:05:00"
                autoFocus
                className="w-full px-3.5 py-2 rounded-xl bg-white/10 border border-white/20 text-white font-mono text-sm focus:outline-none focus:border-blue-400 focus:bg-white/15 placeholder-white/40"
              />
              {jumpInputError && (
                <p className="text-[10px] text-red-400 mt-1 pl-1 font-medium">{jumpInputError}</p>
              )}
            </div>

            {/* Quick Jump Delta Chips */}
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {[
                { label: '-1m', delta: -60 },
                { label: '-10s', delta: -10 },
                { label: '+10s', delta: 10 },
                { label: '+1m', delta: 60 },
                { label: '+5m', delta: 300 }
              ].map(chip => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => {
                    const base = videoRef.current ? videoRef.current.currentTime : currentTime;
                    const target = Math.max(0, Math.min(displayDuration, base + chip.delta));
                    setIsJumpModalOpen(false);
                    commitSeek(target);
                    triggerSeekFeedback(chip.delta > 0 ? 'forward' : 'rewind', `${chip.delta > 0 ? '+' : ''}${chip.delta}s`, target);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/90 hover:text-white text-[11px] font-mono cursor-pointer transition-colors border border-white/10"
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1 border-t border-white/10">
              <button
                type="button"
                onClick={() => setIsJumpModalOpen(false)}
                className="px-3 py-1.5 rounded-xl text-white/60 hover:text-white text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-bold text-xs cursor-pointer shadow-md transition-colors"
              >
                Jump to Time
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Auto-Reconnecting Toast */}
      {reconnectToast && (
        <div className="absolute top-16 sm:top-20 inset-x-0 mx-auto w-fit z-40 pointer-events-none animate-in fade-in slide-in-from-top-4 duration-300 px-4">
          <div className="px-5 py-2.5 rounded-full glass-modal bg-amber-500/20 border border-amber-400/40 backdrop-blur-3xl flex items-center gap-2.5 text-amber-200 text-xs font-semibold shadow-2xl">
            <RefreshCw className="w-4 h-4 animate-spin text-amber-300" />
            <span>{reconnectToast}</span>
          </div>
        </div>
      )}

      {/* Transcode Slow Notice Prompt */}
      {isTranscodeSlow && !errorMessage && (
        <div className="absolute top-16 sm:top-20 inset-x-0 mx-auto w-fit max-w-sm px-4 z-40 animate-in fade-in duration-300" data-interactive="true">
          <div className="p-3.5 rounded-2xl glass-modal bg-black/90 border border-white/20 backdrop-blur-3xl flex items-center justify-between gap-3 text-xs shadow-2xl">
            <span className="text-white/80">Transcode taking longer than usual...</span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={fallbackTo1080p}
                className="px-3 py-1.5 rounded-full bg-white text-black font-bold text-[11px] hover:bg-white/90 cursor-pointer"
              >
                1080p
              </button>
              <button
                onClick={fallbackToDirect}
                className="px-3 py-1.5 rounded-full bg-white/20 text-white font-bold text-[11px] hover:bg-white/30 cursor-pointer"
              >
                Direct
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Center Playback Control Cluster: [ -10s ]  [ Play / Pause ]  [ +10s ] with Liquid Glass styling */}
      {!errorMessage && (
        <div
          data-interactive="true"
          className={`absolute inset-0 m-auto w-fit h-fit flex flex-col items-center justify-center gap-3.5 z-30 transition-all duration-300 pointer-events-auto ${
            showControls || !isPlaying
              ? 'opacity-100 scale-100 pointer-events-auto'
              : 'opacity-0 scale-95 pointer-events-none'
          }`}
        >
          {/* Row of 3 Liquid Glass Buttons */}
          <div className="flex items-center justify-center gap-4 sm:gap-7">
            {/* Skip Backward 10s */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                seekRelative(-10);
              }}
              data-interactive="true"
              className="liquid-glass-btn w-12 h-12 sm:w-14 sm:h-14 rounded-full text-white flex flex-col items-center justify-center cursor-pointer group"
              title="Rewind 10s (J / Left Arrow)"
            >
              <RotateCcw className="w-5 h-5 sm:w-6 sm:h-6 group-hover:-rotate-45 transition-transform" />
              <span className="text-[9px] font-bold font-mono tracking-tight text-white/90 -mt-0.5">10</span>
            </button>

            {/* Center Play / Pause Hero Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              data-interactive="true"
              className="liquid-glass-hero w-16 h-16 sm:w-20 sm:h-20 rounded-full text-white flex items-center justify-center cursor-pointer group"
              title={isPlaying ? "Pause (Space / K)" : "Play (Space / K)"}
            >
              {isLoading ? (
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-7 h-7 sm:w-9 sm:h-9 fill-white text-white drop-shadow group-hover:scale-110 transition-transform" />
              ) : (
                <Play className="w-7 h-7 sm:w-9 sm:h-9 fill-white text-white drop-shadow ml-1 group-hover:scale-110 transition-transform" />
              )}
            </button>

            {/* Skip Forward 10s */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                seekRelative(10);
              }}
              data-interactive="true"
              className="liquid-glass-btn w-12 h-12 sm:w-14 sm:h-14 rounded-full text-white flex flex-col items-center justify-center cursor-pointer group"
              title="Forward 10s (L / Right Arrow)"
            >
              <RotateCw className="w-5 h-5 sm:w-6 sm:h-6 group-hover:rotate-45 transition-transform" />
              <span className="text-[9px] font-bold font-mono tracking-tight text-white/90 -mt-0.5">10</span>
            </button>
          </div>

          {/* Dedicated Status Badge cleanly positioned UNDER the buttons when loading */}
          {isLoading && (
            <div className="px-3.5 py-1 rounded-full bg-black/75 backdrop-blur-xl border border-white/20 text-[10px] sm:text-[11px] font-semibold text-white/90 tracking-wider uppercase shadow-xl animate-in fade-in duration-200">
              {isDirectFileMode ? 'Buffering Direct Stream...' : `Transcoding ${quality.toUpperCase()} Stream...`}
            </div>
          )}
        </div>
      )}

      {/* Robust Glassmorphic Playback Error & Recovery Modal */}
      {errorMessage && (
        <div
          data-interactive="true"
          className="absolute inset-0 m-auto max-w-lg h-fit p-5 sm:p-8 rounded-3xl glass-modal bg-[#10131c]/95 backdrop-blur-3xl border border-red-500/40 text-center flex flex-col items-center z-50 shadow-[0_30px_90px_rgba(0,0,0,0.9)] animate-in fade-in zoom-in-95 duration-200 mx-4"
        >
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mb-3 sm:mb-4">
            <AlertCircle className="w-6 h-6 sm:w-7 sm:h-7 text-red-400" />
          </div>
          <h3 className="text-base sm:text-lg font-bold text-white mb-1.5 tracking-tight">Playback Notice</h3>
          <p className="text-xs sm:text-sm font-medium text-white/90 mb-1">{errorMessage}</p>
          <p className="text-[11px] sm:text-xs text-white/50 mb-5 sm:mb-6 leading-relaxed max-w-sm">{errorDetails}</p>

          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5 w-full">
            <button
              onClick={reloadStream}
              className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-full bg-white text-black text-xs font-bold flex items-center gap-2 hover:bg-white/90 shadow-lg cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Auto-Retry
            </button>
            <button
              onClick={fallbackTo1080p}
              className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-semibold border border-white/20 cursor-pointer"
            >
              Switch 1080p Transcode
            </button>
            <button
              onClick={fallbackToDirect}
              className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-semibold border border-white/15 cursor-pointer"
            >
              Fallback Direct Play
            </button>
            <button
              onClick={closePlayer}
              className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-200 text-xs font-semibold border border-red-500/30 cursor-pointer"
            >
              Exit Player
            </button>
          </div>
        </div>
      )}

      {/* Top Floating Glass Bar */}
      <div
        className={`absolute top-0 inset-x-0 p-2.5 sm:p-5 flex items-center justify-between transition-all duration-500 ease-out z-40 ${
          showControls
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-8 pointer-events-none'
        }`}
      >
        {/* Left: Close & Title Info */}
        <div className="flex items-center gap-2 sm:gap-3.5 min-w-0 pr-2">
          <button
            onClick={closePlayer}
            data-interactive="true"
            className="p-2 sm:p-2.5 rounded-full glass-pill bg-black/40 hover:bg-white/20 text-white border border-white/20 transition-all cursor-pointer shrink-0"
            title="Exit Cinema (Esc)"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-xs sm:text-base font-bold text-white tracking-tight flex items-center gap-2 truncate">
              <span className="truncate">{playingItem.showTitle ? `${playingItem.showTitle} — ${playingItem.title}` : playingItem.title}</span>
              <span className="hidden xs:inline-block text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-white/80 shrink-0">
                {isDirectFileMode ? 'Direct File' : (quality === 'direct' ? 'Direct Stream' : quality.toUpperCase())}
              </span>
            </h2>
            <p className="text-[10px] sm:text-xs text-white/50 truncate">
              {playingItem.showTitle
                ? `Season ${playingItem.seasonNumber || 1} • Episode ${playingItem.episodeNumber || 1}`
                : `${playingItem.release_year || playingItem.releaseYear || ''} • ${playingItem.resolution || '4K UHD'}`}
            </p>
          </div>
        </div>

        {/* Right: Dynamic Range (HDR) Toggle */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            onClick={() => setHdrMode(prev => prev === 'on' ? 'off' : 'on')}
            data-interactive="true"
            className={`px-2.5 sm:px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer ${
              hdrMode === 'on'
                ? 'bg-amber-400/25 text-amber-300 border-amber-400/40 shadow-[0_0_15px_rgba(251,191,36,0.25)]'
                : 'bg-white/10 text-white/70 hover:text-white border-white/15'
            }`}
            title={hdrMode === 'on' ? 'HDR10+ Passthrough active. Tap to Turn Off HDR (apply SDR Tonemap)' : 'SDR Tonemap active. Tap to Turn On HDR'}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span className="hidden sm:inline">{hdrMode === 'on' ? 'HDR: ON (10-bit)' : 'HDR: OFF (SDR Tonemap)'}</span>
            <span className="sm:hidden">{hdrMode === 'on' ? 'HDR' : 'SDR'}</span>
          </button>
        </div>
      </div>

      {/* Skip Intro Floating VisionOS Liquid Glass Button with Auto-Dismiss & Manual Close */}
      {isInsideIntro && isIntroVisible && !isIntroDismissed && (
        <div
          data-interactive="true"
          onMouseEnter={() => {
            if (introTimerRef.current) {
              clearTimeout(introTimerRef.current);
              introTimerRef.current = null;
            }
          }}
          onMouseLeave={() => {
            if (!isIntroDismissed) {
              if (introTimerRef.current) clearTimeout(introTimerRef.current);
              introTimerRef.current = setTimeout(() => {
                setIsIntroVisible(false);
                setIsIntroDismissed(true);
              }, 2500);
            }
          }}
          className="absolute right-4 sm:right-8 bottom-20 sm:bottom-24 z-40 animate-in fade-in slide-in-from-right-4 duration-300"
        >
          <div className="flex items-center gap-1.5 p-1 rounded-full liquid-glass-btn bg-black/85 hover:bg-black/95 text-white border border-white/30 backdrop-blur-3xl shadow-[0_12px_36px_rgba(0,0,0,0.8)] transition-all">
            <button
              onClick={handleSkipIntro}
              className="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full text-white flex items-center gap-2 text-xs sm:text-sm font-bold tracking-wide hover:scale-105 active:scale-95 cursor-pointer transition-transform"
              title="Skip Intro (or press 'S')"
            >
              <FastForward className="w-4 h-4 text-blue-400" />
              <span>Skip Intro</span>
            </button>
            <button
              onClick={handleDismissIntro}
              className="p-1 sm:p-1.5 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Dismiss prompt"
              aria-label="Dismiss Skip Intro"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* TV Series Next Episode Countdown Prompt */}
      {nextEpisodeCountdown !== null && (
        <div
          data-interactive="true"
          className="absolute right-4 sm:right-8 bottom-28 z-40 p-3 sm:p-4 rounded-2xl glass-modal bg-black/85 border border-white/20 flex items-center gap-3 sm:gap-4 shadow-2xl animate-bounce"
        >
          <div>
            <p className="text-[10px] text-white/60 uppercase tracking-wider font-semibold">Up Next in {nextEpisodeCountdown}s</p>
            <p className="text-xs sm:text-sm font-bold text-white">Next Episode</p>
          </div>
          <button
            onClick={() => setNextEpisodeCountdown(null)}
            className="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full glass-pill bg-white text-black font-bold text-xs flex items-center gap-1 hover:bg-white/90 cursor-pointer"
          >
            Play Next <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Bottom Floating VisionOS Glass Control Center (Small & Sleek) */}
      <div
        className={`absolute bottom-2 sm:bottom-4 inset-x-0 flex justify-center px-2 sm:px-4 transition-all duration-500 ease-out z-40 ${
          showControls
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-8 pointer-events-none'
        }`}
      >
        <div
          data-interactive="true"
          className="w-full max-w-3xl py-1 px-2.5 sm:py-2 sm:px-3.5 rounded-xl sm:rounded-2xl glass-pill bg-black/75 backdrop-blur-3xl border border-white/[0.18] shadow-[0_16px_40px_rgba(0,0,0,0.8)] flex flex-col gap-0.5 sm:gap-1"
        >
          {/* Row 1: Scrubber Bar with Buffered Progress & Visible Playhead Knob */}
          <div className="flex items-center gap-2 sm:gap-2.5 w-full px-0.5">
            {/* Clickable Current Time to open Jump to Timestamp */}
            <button
              onClick={() => {
                setIsJumpModalOpen(prev => !prev);
                setJumpInputVal(formatTime(activeCurrentTime));
                setJumpInputError('');
              }}
              data-interactive="true"
              className="text-[10px] sm:text-[11px] font-mono text-white/90 hover:text-blue-300 min-w-[36px] sm:min-w-[46px] select-none text-left px-1 py-0.5 rounded hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1 group"
              title="Click or press 'G' to jump to exact timestamp"
            >
              <span>{formatTime(activeCurrentTime)}</span>
              <Clock className="w-2.5 h-2.5 text-white/40 group-hover:text-blue-300 hidden sm:inline" />
            </button>

            {/* Scrubber Container with Direct Touch/Pointer Capture for High-Precision Scrubbing */}
            <div
              ref={scrubberContainerRef}
              className="relative flex-1 flex items-center h-5 sm:h-6 cursor-pointer group touch-none select-none py-1"
              onPointerDown={handleScrubberPointerDown}
              onPointerMove={handleScrubberPointerMove}
              onPointerUp={handleScrubberPointerUp}
              onPointerCancel={handleScrubberPointerUp}
              onMouseLeave={handleScrubberMouseLeave}
              title="Drag or Click to Seek (Scroll wheel: ±1s, Shift+Scroll: ±0.1s)"
            >
              {/* Floating Active Scrub / Hover Timestamp Tooltip */}
              {(isScrubbing || hoverPosition) && (() => {
                const tooltipTime = isScrubbing ? scrubTime : (hoverPosition?.time || 0);
                const hoverChapter = chapters && chapters.length > 0
                  ? chapters.find(c => tooltipTime >= getChapStart(c) && tooltipTime < getChapEnd(c))
                  : null;

                return (
                  <div
                    className={`absolute -top-7 -translate-x-1/2 pointer-events-none px-2.5 py-0.5 rounded-lg glass-modal bg-black/95 border border-white/25 text-[10px] font-mono text-white shadow-xl z-30 transition-all flex items-center gap-1.5 ${
                      isScrubbing ? 'scale-105 shadow-[0_0_15px_rgba(59,130,246,0.6)] border-blue-400/50' : ''
                    }`}
                    style={{
                      left: `${isScrubbing ? progressPercent : (hoverPosition?.percent || 0)}%`
                    }}
                  >
                    <span className="font-bold text-blue-300">
                      {formatTimeWithSubseconds(tooltipTime)}
                    </span>
                    {hoverChapter?.title && (
                      <span className="text-white/80 font-sans font-medium truncate max-w-[140px] border-l border-white/20 pl-1.5">
                        {hoverChapter.title}
                      </span>
                    )}
                    {isScrubbing && (
                      <span className="text-[9px] text-white/60 font-semibold">
                        ({scrubTime >= currentTime ? '+' : ''}{(scrubTime - currentTime).toFixed(1)}s)
                      </span>
                    )}
                  </div>
                );
              })()}

              {/* Background Track Bar */}
              <div className="absolute inset-x-0 h-1 sm:h-1.5 rounded-full bg-white/20 overflow-hidden pointer-events-none">
                {/* Buffered Chunks Progress */}
                <div
                  className="absolute h-full bg-white/30 transition-all duration-300"
                  style={{ left: `${bufferedStartPercent}%`, width: `${bufferedWidthPercent}%` }}
                />
              </div>

              {/* Chapter Marker Ticks */}
              {chapters && chapters.length > 1 && displayDuration > 0 && (
                <div className="absolute inset-x-0 h-1 sm:h-1.5 pointer-events-none z-10">
                  {chapters.map((chap, idx) => {
                    const start = getChapStart(chap);
                    if (start <= 0) return null;
                    const pct = Math.min(100, Math.max(0, (start / displayDuration) * 100));
                    return (
                      <div
                        key={chap.id || idx}
                        className="absolute top-0 bottom-0 w-[2px] bg-black/80 border-l border-white/80"
                        style={{ left: `${pct}%` }}
                        title={chap.title}
                      />
                    );
                  })}
                </div>
              )}

              {/* Played Gradient Fill */}
              <div
                className="absolute left-0 h-1 sm:h-1.5 rounded-full bg-gradient-to-r from-blue-400 via-indigo-400 to-cyan-300 pointer-events-none shadow-[0_0_10px_rgba(129,140,248,0.7)]"
                style={{ width: `${progressPercent}%` }}
              />

              {/* Visible Playhead Knob */}
              <div
                className={`absolute -translate-x-1/2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,1)] border-2 border-blue-400 pointer-events-none transition-transform duration-75 ${
                  isScrubbing ? 'w-4 h-4 scale-125 bg-blue-100 border-white ring-2 ring-blue-500/40' : 'w-2.5 h-2.5 sm:w-3 sm:h-3 group-hover:scale-125'
                }`}
                style={{ left: `${progressPercent}%` }}
              />
            </div>

            {/* Total / Remaining Time Toggle */}
            <button
              onClick={() => setShowRemainingTime(prev => !prev)}
              data-interactive="true"
              className="text-[10px] sm:text-[11px] font-mono text-white/70 hover:text-white min-w-[36px] sm:min-w-[46px] text-right cursor-pointer select-none px-1 py-0.5 rounded hover:bg-white/10 transition-colors"
              title="Click to toggle Total / Remaining Time"
            >
              {showRemainingTime ? `-${formatTime(remainingTime)}` : formatTime(displayDuration)}
            </button>
          </div>

          {/* Fine Scrub Micro-Stepper Bar (Active while dragging/scrubbing) */}
          {isScrubbing && (
            <div className="flex items-center justify-center gap-1.5 py-0.5 px-2 bg-blue-500/10 border border-blue-400/20 rounded-xl animate-in fade-in zoom-in-95 duration-150">
              <span className="text-[10px] uppercase font-bold tracking-wider text-blue-300 flex items-center gap-1 mr-1">
                <Zap className="w-3 h-3 text-blue-400" /> Fine Adjust:
              </span>
              {[
                { label: '-10s', delta: -10 },
                { label: '-1s', delta: -1 },
                { label: '+1s', delta: 1 },
                { label: '+10s', delta: 10 }
              ].map(chip => (
                <button
                  key={chip.label}
                  type="button"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const newTime = Math.max(0, Math.min(displayDuration, scrubTime + chip.delta));
                    setScrubTime(newTime);
                  }}
                  className="px-2 py-0.5 rounded-lg bg-white/15 hover:bg-white/25 active:bg-blue-500 text-white text-[10px] font-mono font-bold cursor-pointer transition-colors border border-white/20"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}

          {/* Row 2: Controls Buttons Row */}
          <div className="flex items-center justify-between pt-0.5">
            {/* Left Cluster: Playback & Volume */}
            <div className="flex items-center gap-1 sm:gap-1.5">
              {/* Play/Pause Button */}
              <button
                onClick={togglePlay}
                data-interactive="true"
                className="liquid-glass-hero w-7 h-7 sm:w-8 sm:h-8 rounded-full text-white flex items-center justify-center cursor-pointer shadow-md shrink-0"
                title="Play/Pause (Space)"
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5 fill-white text-white" /> : <Play className="w-3.5 h-3.5 fill-white text-white ml-0.5" />}
              </button>

              {/* Seek Backward 10s */}
              <button
                onClick={() => seekRelative(-10)}
                data-interactive="true"
                className="liquid-glass-btn group w-6 h-6 sm:w-7 sm:h-7 rounded-full text-white/90 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
                title="Rewind 10s (J / Left Arrow)"
              >
                <RotateCcw className="w-3 h-3 sm:w-3.5 sm:h-3.5 group-hover:-rotate-45 transition-transform duration-200" />
              </button>

              {/* Seek Forward 10s */}
              <button
                onClick={() => seekRelative(10)}
                data-interactive="true"
                className="liquid-glass-btn group w-6 h-6 sm:w-7 sm:h-7 rounded-full text-white/90 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
                title="Forward 10s (L / Right Arrow)"
              >
                <RotateCw className="w-3 h-3 sm:w-3.5 sm:h-3.5 group-hover:rotate-45 transition-transform duration-200" />
              </button>

              {/* Volume Button with Mute Toggle & Desktop Slider */}
              <div className="relative flex items-center gap-1 ml-0.5">
                <button
                  onClick={() => setIsMuted(prev => !prev)}
                  data-interactive="true"
                  className="w-6 h-6 sm:w-7 sm:h-7 rounded-full text-white/80 hover:text-white hover:bg-white/10 flex items-center justify-center cursor-pointer shrink-0"
                  title="Mute/Unmute (M)"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-3.5 h-3.5 text-red-300" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-3.5 h-3.5" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Horizontal Volume Slider on Desktop & Tablets */}
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setVolume(val);
                    if (videoRef.current) videoRef.current.volume = val;
                    setIsMuted(val === 0);
                  }}
                  className="w-12 sm:w-16 h-1 bg-white/20 rounded-full appearance-none cursor-pointer accent-white hidden md:inline"
                />
              </div>
            </div>

            {/* Right Cluster: Desktop Popovers OR Mobile Quick Settings */}
            <div className="flex items-center gap-1 sm:gap-1.5 relative">
              {/* DESKTOP & TABLET CONTROLS (>= 640px) */}
              <div className="hidden sm:flex items-center gap-1.5">
                {/* Jump to Timestamp Button */}
                <button
                  onClick={() => {
                    setIsJumpModalOpen(prev => !prev);
                    setJumpInputVal(formatTime(activeCurrentTime));
                    setJumpInputError('');
                  }}
                  data-interactive="true"
                  className={`p-1.5 sm:p-2 rounded-full border transition-all cursor-pointer ${
                    isJumpModalOpen
                      ? 'bg-blue-500/30 text-blue-300 border-blue-400/50 shadow-[0_0_12px_rgba(59,130,246,0.3)]'
                      : 'bg-white/10 hover:bg-white/20 text-white/90 border-white/15'
                  }`}
                  title="Go to Particular Timestamp (G)"
                >
                  <Clock className="w-4 h-4" />
                </button>

                {/* Speed Selector */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setSpeedMenuOpen(prev => !prev);
                      setQualityMenuOpen(false);
                      setAudioMenuOpen(false);
                      setSubMenuOpen(false);
                    }}
                    data-interactive="true"
                    className={`px-2.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1 border transition-all cursor-pointer ${
                      speedMenuOpen ? 'bg-white text-black border-white' : 'bg-white/10 hover:bg-white/20 text-white/90 border-white/15'
                    }`}
                    title="Playback Speed"
                  >
                    <Gauge className="w-3.5 h-3.5" />
                    <span>{playbackSpeed}x</span>
                  </button>

                  {speedMenuOpen && (
                    <div
                      data-interactive="true"
                      className="absolute bottom-12 right-0 w-36 max-h-48 overflow-y-auto glass-modal bg-black/95 p-1.5 border border-white/20 shadow-2xl rounded-2xl z-50 animate-in fade-in zoom-in-95 duration-150"
                    >
                      <p className="text-[10px] uppercase font-bold tracking-wider text-white/40 px-2.5 py-1">Speed</p>
                      {SPEEDS.map(s => (
                        <button
                          key={s}
                          onClick={() => {
                            setPlaybackSpeed(s);
                            setSpeedMenuOpen(false);
                            revealControls(2500);
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer ${
                            playbackSpeed === s ? 'bg-white/20 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <span>{s === 1 ? '1.0x (Normal)' : `${s}x`}</span>
                          {playbackSpeed === s && <Check className="w-3.5 h-3.5 text-blue-400" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quality Selector */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setQualityMenuOpen(prev => !prev);
                      setSpeedMenuOpen(false);
                      setAudioMenuOpen(false);
                      setSubMenuOpen(false);
                    }}
                    data-interactive="true"
                    className={`px-2.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 border transition-all cursor-pointer ${
                      qualityMenuOpen ? 'bg-white text-black border-white' : 'bg-white/10 hover:bg-white/20 text-white border-white/15'
                    }`}
                    title="Streaming Quality"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>{isDirectFileMode ? 'Direct File' : (quality === 'direct' ? 'Direct' : quality.toUpperCase())}</span>
                  </button>

                  {qualityMenuOpen && (
                    <div
                      data-interactive="true"
                      className="absolute bottom-12 right-0 w-64 max-h-56 overflow-y-auto glass-modal bg-black/95 p-2 border border-white/20 shadow-2xl rounded-2xl z-50 animate-in fade-in zoom-in-95 duration-150"
                    >
                      <p className="text-[10px] uppercase font-bold tracking-wider text-white/40 px-2 py-1">Streaming Quality</p>
                      {QUALITIES.map(q => (
                        <button
                          key={q.id}
                          onClick={() => {
                            setIsDirectFileMode(false);
                            setQuality(q.id);
                            setQualityMenuOpen(false);
                            revealControls(2500);
                          }}
                          className={`w-full text-left px-3 py-1.5 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer ${
                            quality === q.id && !isDirectFileMode ? 'bg-white/20 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <div>
                            <p className="font-semibold text-white">{q.label}</p>
                            <p className="text-[10px] text-white/50">{q.desc}</p>
                          </div>
                          {quality === q.id && !isDirectFileMode && <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Audio Tracks Trigger */}
                {audioTracks.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => {
                        setAudioMenuOpen(prev => !prev);
                        setQualityMenuOpen(false);
                        setSpeedMenuOpen(false);
                        setSubMenuOpen(false);
                      }}
                      data-interactive="true"
                      className={`p-2 rounded-full border transition-all cursor-pointer ${
                        audioMenuOpen ? 'bg-white text-black border-white' : 'bg-white/10 hover:bg-white/20 text-white border-white/15'
                      }`}
                      title="Audio Tracks"
                    >
                      <Volume1 className="w-4 h-4" />
                    </button>

                    {audioMenuOpen && (
                      <div
                        data-interactive="true"
                        className="absolute bottom-12 right-0 w-56 max-h-48 overflow-y-auto glass-modal bg-black/95 p-2 border border-white/20 shadow-2xl rounded-2xl z-50 animate-in fade-in zoom-in-95 duration-150"
                      >
                        <p className="text-[10px] uppercase font-bold tracking-wider text-white/40 px-2 py-1">Audio Stream</p>
                        {audioTracks.map((aud, i) => (
                          <button
                            key={aud.stream_index ?? i}
                            onClick={() => {
                              setSelectedAudioTrack(aud.stream_index);
                              setAudioMenuOpen(false);
                              revealControls(2500);
                            }}
                            className={`w-full text-left px-3 py-1.5 rounded-xl text-xs flex items-center justify-between cursor-pointer ${
                              selectedAudioTrack === aud.stream_index ? 'bg-white/20 text-white font-bold' : 'text-white/70 hover:bg-white/10'
                            }`}
                          >
                            <span className="truncate">{aud.title || `Track ${i + 1} (${aud.language || 'und'})`}</span>
                            {selectedAudioTrack === aud.stream_index && <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Subtitles Trigger */}
                {subtitleTracks.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => {
                        setSubMenuOpen(prev => !prev);
                        setQualityMenuOpen(false);
                        setSpeedMenuOpen(false);
                        setAudioMenuOpen(false);
                      }}
                      data-interactive="true"
                      className={`p-2 rounded-full border transition-all cursor-pointer ${
                        selectedSubtitleTrack >= 0 ? 'bg-white/30 text-white border-white/40' : 'bg-white/10 hover:bg-white/20 text-white/70 border-white/15'
                      }`}
                      title="Subtitles"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>

                    {subMenuOpen && (
                      <div
                        data-interactive="true"
                        className="absolute bottom-12 right-0 w-64 max-h-72 overflow-y-auto glass-modal bg-black/95 p-2 border border-white/20 shadow-2xl rounded-2xl z-50 animate-in fade-in zoom-in-95 duration-150"
                      >
                        <p className="text-[10px] uppercase font-bold tracking-wider text-white/40 px-2 py-1">Subtitles</p>
                        <button
                          onClick={() => {
                            setSelectedSubtitleTrack(-1);
                            setSubMenuOpen(false);
                            revealControls(2500);
                          }}
                          className={`w-full text-left px-3 py-1.5 rounded-xl text-xs flex items-center justify-between cursor-pointer ${
                            selectedSubtitleTrack === -1 ? 'bg-white/20 text-white font-bold' : 'text-white/70 hover:bg-white/10'
                          }`}
                        >
                          <span>Off</span>
                          {selectedSubtitleTrack === -1 && <Check className="w-3.5 h-3.5 text-blue-400" />}
                        </button>
                        {subtitleTracks.map((sub, i) => (
                          <button
                            key={sub.stream_index ?? i}
                            onClick={() => {
                              setSelectedSubtitleTrack(sub.stream_index ?? i);
                              setSubMenuOpen(false);
                              revealControls(2500);
                            }}
                            className={`w-full text-left px-3 py-1.5 rounded-xl text-xs flex items-center justify-between cursor-pointer ${
                              selectedSubtitleTrack === (sub.stream_index ?? i) ? 'bg-white/20 text-white font-bold' : 'text-white/70 hover:bg-white/10'
                            }`}
                          >
                            <span className="truncate">{sub.title || `Subtitles (${sub.language || 'und'})`}</span>
                            {selectedSubtitleTrack === (sub.stream_index ?? i) && <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                          </button>
                        ))}

                        {/* Subtitle Sync Offset Controls */}
                        {selectedSubtitleTrack >= 0 && (
                          <div className="mt-2.5 pt-2 border-t border-white/15 px-1 space-y-1.5">
                            <div className="flex items-center justify-between text-[10px] font-bold uppercase text-white/60">
                              <span>Sync Offset</span>
                              <span className={`font-mono ${subtitleOffset !== 0 ? 'text-amber-300 font-bold' : 'text-white/40'}`}>
                                {subtitleOffset > 0 ? `+${subtitleOffset.toFixed(2)}s` : `${subtitleOffset.toFixed(2)}s`}
                              </span>
                            </div>
                            <div className="grid grid-cols-4 gap-1">
                              {[
                                { label: '-1s', delta: -1.0 },
                                { label: '-0.25s', delta: -0.25 },
                                { label: '+0.25s', delta: 0.25 },
                                { label: '+1s', delta: 1.0 }
                              ].map(chip => (
                                <button
                                  key={chip.label}
                                  type="button"
                                  onClick={() => {
                                    setSubtitleOffset(prev => parseFloat((prev + chip.delta).toFixed(3)));
                                  }}
                                  className="px-1 py-1 rounded bg-white/10 hover:bg-white/20 text-[10px] font-mono text-white/90 text-center transition-colors cursor-pointer"
                                >
                                  {chip.label}
                                </button>
                              ))}
                            </div>
                            <div className="grid grid-cols-4 gap-1 pt-0.5">
                              {[
                                { label: '-0.5s', delta: -0.5 },
                                { label: '-0.1s', delta: -0.1 },
                                { label: '+0.1s', delta: 0.1 },
                                { label: '+0.5s', delta: 0.5 }
                              ].map(chip => (
                                <button
                                  key={chip.label}
                                  type="button"
                                  onClick={() => {
                                    setSubtitleOffset(prev => parseFloat((prev + chip.delta).toFixed(3)));
                                  }}
                                  className="px-1 py-1 rounded bg-white/10 hover:bg-white/20 text-[10px] font-mono text-white/90 text-center transition-colors cursor-pointer"
                                >
                                  {chip.label}
                                </button>
                              ))}
                            </div>
                            {subtitleOffset !== 0 && (
                              <button
                                type="button"
                                onClick={() => setSubtitleOffset(0)}
                                className="w-full mt-1 py-1 text-[10px] rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white font-mono cursor-pointer"
                              >
                                Reset Offset (0.0s)
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Speech Clarity (Dialogue Enhancement) */}
                <button
                  onClick={toggleSpeechClarity}
                  data-interactive="true"
                  className={`p-1.5 sm:p-2 rounded-full border transition-all cursor-pointer ${
                    speechClarity
                      ? 'bg-emerald-500/30 text-emerald-300 border-emerald-400/50 shadow-[0_0_12px_rgba(52,211,153,0.3)]'
                      : 'bg-white/10 hover:bg-white/20 text-white/90 border-white/15'
                  }`}
                  title={`Speech Clarity: ${speechClarity ? 'ON (Dialogue Boost)' : 'OFF'} (Press C)`}
                >
                  <Headphones className="w-4 h-4" />
                </button>

                {/* Aspect Ratio Mode (Fit / Fill / Stretch) */}
                <button
                  onClick={cycleAspectRatio}
                  data-interactive="true"
                  className="px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-full border text-[11px] font-bold transition-all cursor-pointer bg-white/10 hover:bg-white/20 text-white border-white/15 flex items-center gap-1"
                  title={`Aspect Ratio: ${aspectRatioMode.toUpperCase()} (Fit / Fill / Stretch) (Press A)`}
                >
                  <span className="uppercase text-[10px] tracking-wider">{aspectRatioMode}</span>
                </button>

                {/* Stats for Nerds HUD Button */}
                <button
                  onClick={() => setShowStatsForNerds(prev => !prev)}
                  data-interactive="true"
                  className={`p-1.5 sm:p-2 rounded-full border transition-all cursor-pointer ${
                    showStatsForNerds
                      ? 'bg-emerald-500/30 text-emerald-300 border-emerald-400/50 shadow-[0_0_12px_rgba(52,211,153,0.3)]'
                      : 'bg-white/10 hover:bg-white/20 text-white/90 border-white/15'
                  }`}
                  title="Stats for Nerds: Stream Diagnostics HUD (N)"
                >
                  <Activity className="w-4 h-4" />
                </button>
              </div>

              {/* MOBILE UNIFIED SETTINGS BUTTON (< 640px) */}
              <div className="flex sm:hidden items-center gap-1">
                <button
                  onClick={() => {
                    setIsJumpModalOpen(true);
                    setJumpInputVal(formatTime(activeCurrentTime));
                  }}
                  data-interactive="true"
                  className="p-1.5 rounded-full bg-white/15 border border-white/20 text-white"
                  title="Jump to Time"
                >
                  <Clock className="w-3.5 h-3.5 text-blue-300" />
                </button>
                <button
                  onClick={() => setIsMobileSettingsOpen(true)}
                  data-interactive="true"
                  className="px-2.5 py-1.5 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/30 border border-white/20 text-xs font-semibold flex items-center gap-1.5 text-white transition-all cursor-pointer"
                  title="Playback Settings"
                >
                  <Sliders className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-[11px] font-bold">{quality === 'direct' ? 'DIRECT' : quality.toUpperCase()} • {playbackSpeed}x</span>
                </button>
              </div>

              {/* Picture-in-Picture Button */}
              {document.pictureInPictureEnabled && (
                <button
                  onClick={togglePiP}
                  data-interactive="true"
                  className={`p-1.5 sm:p-2 rounded-full border transition-all cursor-pointer ${
                    isPiP ? 'bg-white text-black border-white' : 'bg-white/10 hover:bg-white/20 text-white border-white/15'
                  }`}
                  title="Picture in Picture (P)"
                >
                  <PictureInPicture className="w-4 h-4" />
                </button>
              )}

              {/* Fullscreen Button */}
              <button
                onClick={toggleFullscreen}
                data-interactive="true"
                className="p-1.5 sm:p-2 rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-all cursor-pointer"
                title="Fullscreen (F)"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MOBILE PLAYBACK SETTINGS ACTION SHEET (< 640px) */}
      {isMobileSettingsOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end pointer-events-auto animate-in fade-in duration-200">
          {/* Backdrop Dimmer */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsMobileSettingsOpen(false)}
          />

          {/* Bottom Glass Sheet */}
          <div
            data-interactive="true"
            className="relative w-full max-h-[80vh] overflow-y-auto rounded-t-3xl glass-modal bg-[#10131c]/95 border-t border-white/20 shadow-2xl p-5 space-y-5 animate-in slide-in-from-bottom duration-250 z-10"
          >
            {/* Sheet Handle */}
            <div className="w-12 h-1.5 rounded-full bg-white/30 mx-auto -mt-1" />

            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">Playback Settings</h3>
              </div>
              <button
                onClick={() => setIsMobileSettingsOpen(false)}
                className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Playback Speed Section */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5" /> Playback Speed
              </label>
              <div className="grid grid-cols-6 gap-1.5">
                {SPEEDS.map(s => (
                  <button
                    key={s}
                    onClick={() => setPlaybackSpeed(s)}
                    className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      playbackSpeed === s
                        ? 'bg-white text-black shadow-md'
                        : 'bg-white/10 text-white/70 hover:bg-white/15'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>

            {/* Streaming Quality Section */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" /> Streaming Quality Profile
              </label>
              <div className="space-y-1.5">
                {QUALITIES.map(q => (
                  <button
                    key={q.id}
                    onClick={() => {
                      setIsDirectFileMode(false);
                      setQuality(q.id);
                    }}
                    className={`w-full px-4 py-3 rounded-2xl text-left text-xs flex items-center justify-between border transition-all cursor-pointer ${
                      quality === q.id && !isDirectFileMode
                        ? 'bg-white/20 border-white/30 text-white'
                        : 'bg-white/[0.05] border-white/10 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    <div>
                      <p className="font-bold text-sm text-white">{q.label}</p>
                      <p className="text-[11px] text-white/50">{q.desc}</p>
                    </div>
                    {quality === q.id && !isDirectFileMode && <Check className="w-4 h-4 text-blue-400" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Audio Tracks Section */}
            {audioTracks.length > 0 && (
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                  <Volume1 className="w-3.5 h-3.5" /> Audio Stream Language
                </label>
                <div className="space-y-1.5">
                  {audioTracks.map((aud, i) => (
                    <button
                      key={aud.stream_index ?? i}
                      onClick={() => setSelectedAudioTrack(aud.stream_index)}
                      className={`w-full px-4 py-2.5 rounded-2xl text-left text-xs flex items-center justify-between border transition-all cursor-pointer ${
                        selectedAudioTrack === aud.stream_index
                          ? 'bg-white/20 border-white/30 text-white'
                          : 'bg-white/[0.05] border-white/10 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      <span className="font-semibold text-sm">{aud.title || `Track ${i + 1} (${aud.language || 'und'})`}</span>
                      {selectedAudioTrack === aud.stream_index && <Check className="w-4 h-4 text-blue-400" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Subtitles Section */}
            {subtitleTracks.length > 0 && (
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" /> Subtitles (WebVTT)
                </label>
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  <button
                    onClick={() => setSelectedSubtitleTrack(-1)}
                    className={`w-full px-4 py-2.5 rounded-2xl text-left text-xs flex items-center justify-between border transition-all cursor-pointer ${
                      selectedSubtitleTrack === -1
                        ? 'bg-white/20 border-white/30 text-white'
                        : 'bg-white/[0.05] border-white/10 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    <span className="font-semibold text-sm">Off</span>
                    {selectedSubtitleTrack === -1 && <Check className="w-4 h-4 text-blue-400" />}
                  </button>
                  {subtitleTracks.map((sub, i) => (
                    <button
                      key={sub.stream_index ?? i}
                      onClick={() => setSelectedSubtitleTrack(sub.stream_index ?? i)}
                      className={`w-full px-4 py-2.5 rounded-2xl text-left text-xs flex items-center justify-between border transition-all cursor-pointer ${
                        selectedSubtitleTrack === (sub.stream_index ?? i)
                          ? 'bg-white/20 border-white/30 text-white'
                          : 'bg-white/[0.05] border-white/10 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      <span className="font-semibold text-sm truncate">{sub.title || `Subtitles (${sub.language || 'und'})`}</span>
                      {selectedSubtitleTrack === (sub.stream_index ?? i) && <Check className="w-4 h-4 text-blue-400 shrink-0" />}
                    </button>
                  ))}
                </div>

                {/* Mobile Subtitle Sync Offset Controls */}
                {selectedSubtitleTrack >= 0 && (
                  <div className="mt-2 pt-2 border-t border-white/15 px-1 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase text-white/60">
                      <span>Sync Offset</span>
                      <span className={`font-mono ${subtitleOffset !== 0 ? 'text-amber-300 font-bold' : 'text-white/40'}`}>
                        {subtitleOffset > 0 ? `+${subtitleOffset.toFixed(2)}s` : `${subtitleOffset.toFixed(2)}s`}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { label: '-1s', delta: -1.0 },
                        { label: '-0.25s', delta: -0.25 },
                        { label: '+0.25s', delta: 0.25 },
                        { label: '+1s', delta: 1.0 }
                      ].map(chip => (
                        <button
                          key={chip.label}
                          type="button"
                          onClick={() => {
                            setSubtitleOffset(prev => parseFloat((prev + chip.delta).toFixed(3)));
                          }}
                          className="py-1.5 rounded-xl bg-white/10 active:bg-white/25 text-xs font-mono text-white/90 text-center transition-colors cursor-pointer"
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 pt-1">
                      {[
                        { label: '-0.5s', delta: -0.5 },
                        { label: '-0.1s', delta: -0.1 },
                        { label: '+0.1s', delta: 0.1 },
                        { label: '+0.5s', delta: 0.5 }
                      ].map(chip => (
                        <button
                          key={chip.label}
                          type="button"
                          onClick={() => {
                            setSubtitleOffset(prev => parseFloat((prev + chip.delta).toFixed(3)));
                          }}
                          className="py-1.5 rounded-xl bg-white/10 active:bg-white/25 text-xs font-mono text-white/90 text-center transition-colors cursor-pointer"
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                    {subtitleOffset !== 0 && (
                      <button
                        type="button"
                        onClick={() => setSubtitleOffset(0)}
                        className="w-full mt-1 py-1.5 text-xs rounded-xl bg-white/10 active:bg-white/20 text-white/70 hover:text-white font-mono cursor-pointer"
                      >
                        Reset Offset (0.0s)
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Audio & Cinema Enhancements (Clarity & Aspect Ratio) */}
            <div className="space-y-2 pt-1 border-t border-white/10">
              <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" /> Audio & Display Enhancements
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={toggleSpeechClarity}
                  className={`p-3 rounded-2xl border text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all ${
                    speechClarity
                      ? 'bg-emerald-500/25 border-emerald-400/40 text-emerald-300'
                      : 'bg-white/10 border-white/15 text-white/90 hover:bg-white/15'
                  }`}
                >
                  <Headphones className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="text-left">
                    <p className="font-bold">Speech Clarity</p>
                    <p className="text-[10px] text-white/50">{speechClarity ? 'Enabled (Boost EQ)' : 'Disabled'}</p>
                  </div>
                </button>
                <button
                  onClick={cycleAspectRatio}
                  className="p-3 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold flex items-center gap-2 cursor-pointer text-white/90 transition-all"
                >
                  <Maximize className="w-4 h-4 text-purple-400 shrink-0" />
                  <div className="text-left">
                    <p className="font-bold">Aspect Ratio</p>
                    <p className="text-[10px] text-white/50 uppercase">{aspectRatioMode}</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Stream Diagnostics / Stats for Nerds for Mobile */}
            <div className="space-y-2 pt-1 border-t border-white/10">
              <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-400" /> Diagnostics & Tools
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setIsMobileSettingsOpen(false);
                    setShowStatsForNerds(true);
                  }}
                  className={`p-3 rounded-2xl border text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all ${
                    showStatsForNerds
                      ? 'bg-emerald-500/25 border-emerald-400/40 text-emerald-300'
                      : 'bg-white/10 border-white/15 text-white/90 hover:bg-white/15'
                  }`}
                >
                  <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="text-left">
                    <p className="font-bold">Stats for Nerds</p>
                    <p className="text-[10px] text-white/50">{showStatsForNerds ? 'Active' : 'Show HUD'}</p>
                  </div>
                </button>
                <button
                  onClick={() => {
                    setIsMobileSettingsOpen(false);
                    setIsJumpModalOpen(true);
                    setJumpInputVal(formatTime(activeCurrentTime));
                  }}
                  className="p-3 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold flex items-center gap-2 cursor-pointer text-white/90 transition-all"
                >
                  <Clock className="w-4 h-4 text-blue-400 shrink-0" />
                  <div className="text-left">
                    <p className="font-bold">Jump to Time</p>
                    <p className="text-[10px] text-white/50">Enter Timestamp</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Close Sheet Button */}
            <div className="pt-2">
              <button
                onClick={() => setIsMobileSettingsOpen(false)}
                className="w-full py-3 rounded-full bg-white text-black font-bold text-xs uppercase tracking-wider shadow-lg hover:bg-white/90 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
