import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useServer } from './ServerContext.jsx';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const { activeUser, fetchContinueWatching } = useServer();

  const [playingItem, setPlayingItem] = useState(null);
  const [quality, setQuality] = useState('auto'); // 'auto', 'lossless', 'direct', '4k', '1080p', '720p', '480p'
  const [hdrMode, setHdrMode] = useState('on'); // 'on' (HDR10+ passthrough), 'off' (HDR-to-SDR Tonemap)
  const [audioTracks, setAudioTracks] = useState([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState(null);
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState(-1); // -1 is Off
  const [chapters, setChapters] = useState([]);
  const [introRange, setIntroRange] = useState(null);

  // Heartbeat tracking reference
  const heartbeatTimer = useRef(null);
  const currentPosRef = useRef(0);
  const currentDurRef = useRef(0);

  const startPlaying = async (item, startSeconds = 0) => {
    // If it's a TV show without an episode specified, fetch the first episode
    let target = { ...item };
    target.duration = Number(target.duration || item.duration_seconds || item.duration || 0);

    if (item.type === 'show' && !item.episodeId) {
      try {
        const res = await fetch(`/api/media/${item.id}`);
        if (res.ok) {
          const detailed = await res.json();
          const firstEpisode = detailed.seasons?.[0]?.episodes?.[0];
          if (firstEpisode) {
            target = {
              mediaId: item.id,
              episodeId: firstEpisode.id,
              type: 'show',
              title: firstEpisode.title,
              showTitle: item.title,
              seasonNumber: 1,
              episodeNumber: firstEpisode.episode_number,
              resolution: firstEpisode.resolution || item.resolution,
              hdrFormat: firstEpisode.hdr_format || item.hdr_format,
              duration: Number(firstEpisode.duration_seconds || item.duration_seconds || 0),
              backdropUrl: firstEpisode.still_url || item.backdrop_url,
              posterUrl: item.poster_url,
              startPosition: startSeconds
            };
          }
        }
      } catch (err) {
        console.warn('Failed to load first episode:', err);
      }
    } else {
      target.startPosition = startSeconds;
    }

    // Load available streams, chapters & intro range
    try {
      const url = target.episodeId ? `/api/media/episodes/${target.episodeId}` : `/api/media/${target.mediaId || target.id}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const audios = data.streams?.filter(s => s.stream_type === 'audio') || [];
        const subs = data.streams?.filter(s => s.stream_type === 'subtitle') || [];
        setAudioTracks(audios);
        setSubtitleTracks(subs);
        setChapters(data.chapters || []);
        setIntroRange(data.introRange || null);
        target.chapters = data.chapters || [];
        target.introRange = data.introRange || null;

        const defaultAudio = audios.find(a => a.is_default) || audios[0];
        setSelectedAudioTrack(defaultAudio ? defaultAudio.stream_index : null);
        setSelectedSubtitleTrack(-1);
        if (data.duration_seconds && (!target.duration || target.duration <= 0)) {
          target.duration = Number(data.duration_seconds);
        }
      }
    } catch (_) {}

    setPlayingItem({ ...target });
    currentPosRef.current = startSeconds;
  };

  const closePlayer = () => {
    // Send final progress before closing
    if (playingItem && activeUser) {
      reportProgress(currentPosRef.current, currentDurRef.current, false);
      setTimeout(fetchContinueWatching, 300);
    }
    setPlayingItem(null);
  };

  const reportProgress = async (pos, dur, completed = false) => {
    if (!playingItem || !activeUser) return;
    const targetId = playingItem.episodeId || playingItem.mediaId || playingItem.id;
    try {
      await fetch('/api/playback/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: activeUser.id,
          mediaId: targetId,
          positionSeconds: pos,
          durationSeconds: dur,
          completed
        })
      });
    } catch (_) {}
  };

  const updateProgress = (pos, dur) => {
    currentPosRef.current = pos;
    currentDurRef.current = dur;
  };

  // 5-second interval progress heartbeat
  useEffect(() => {
    if (playingItem) {
      heartbeatTimer.current = setInterval(() => {
        if (currentDurRef.current > 0) {
          reportProgress(currentPosRef.current, currentDurRef.current);
        }
      }, 5000);
    } else {
      clearInterval(heartbeatTimer.current);
    }
    return () => clearInterval(heartbeatTimer.current);
  }, [playingItem]);

  // Support ?play=<id> query parameter
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const playId = params.get('play') || params.get('player');
      if (playId) {
        fetch(`/api/media/${playId}`)
          .then(res => res.json())
          .then(item => {
            if (item && (item.id || item.title)) {
              startPlaying(item);
            }
          })
          .catch(() => {});
      }
    } catch (_) {}
  }, []);

  return (
    <PlayerContext.Provider value={{
      playingItem,
      startPlaying,
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
      setChapters,
      introRange,
      setIntroRange,
      updateProgress,
      reportProgress
    }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error('usePlayer must be used within PlayerProvider');
  return context;
}
