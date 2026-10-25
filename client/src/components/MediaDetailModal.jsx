import React, { useState, useEffect } from 'react';
import { X, Play, Sparkles, Star, Calendar, Clock, Film, Tv, Heart, Bookmark } from 'lucide-react';
import { useServer } from '../context/ServerContext.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';

export default function MediaDetailModal() {
  const { detailModalItem, setDetailModalItem, favorites, watchlist, toggleFavorite, toggleWatchlist } = useServer();
  const { startPlaying } = usePlayer();

  const [fullItem, setFullItem] = useState(null);
  const [activeSeasonNum, setActiveSeasonNum] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!detailModalItem) {
      setFullItem(null);
      return;
    }

    setLoading(true);
    fetch(`/api/media/${detailModalItem.id}`)
      .then(res => res.json())
      .then(data => {
        setFullItem(data);
        if (data.seasons && data.seasons.length > 0) {
          setActiveSeasonNum(data.seasons[0].season_number);
        }
      })
      .catch(err => console.error('Error fetching details:', err))
      .finally(() => setLoading(false));
  }, [detailModalItem]);

  if (!detailModalItem) return null;

  const item = fullItem || detailModalItem;
  const isFav = favorites ? favorites.has(item.id) : Boolean(item.is_favorite);
  const inWatch = watchlist ? watchlist.has(item.id) : Boolean(item.in_watchlist);
  const currentSeason = item.seasons?.find(s => s.season_number === activeSeasonNum);

  const formatDuration = (seconds) => {
    if (!seconds) return '2h 10m';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      {/* Backdrop Dimmer */}
      <div 
        className="fixed inset-0 bg-black/80 backdrop-blur-2xl transition-opacity"
        onClick={() => setDetailModalItem(null)}
      />

      {/* Liquid Glass Modal Card */}
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl glass-modal bg-[#10131c]/90 border border-white/20 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85)] z-10 no-scrollbar">
        
        {/* Close Button */}
        <button
          onClick={() => setDetailModalItem(null)}
          className="absolute top-4 right-4 z-20 p-2.5 rounded-full bg-black/50 hover:bg-white/20 text-white/80 hover:text-white border border-white/15 transition-all"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Hero Backdrop Banner */}
        <div className="relative aspect-[16/9] sm:aspect-[21/9] w-full overflow-hidden">
          <img
            src={item.backdrop_url || item.poster_url}
            alt={item.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#10131c] via-[#10131c]/60 to-transparent" />
        </div>

        {/* Header Content */}
        <div className="relative px-4 sm:px-8 -mt-16 sm:-mt-32 pb-8">
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-center sm:items-start text-center sm:text-left">
            
            {/* Poster Card */}
            <div className="w-28 sm:w-48 aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl border border-white/20 shrink-0 bg-black/50">
              <img
                src={item.poster_url}
                alt={item.title}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Info Column */}
            <div className="flex-1 space-y-4">
              <div>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-2">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/10 text-white border border-white/15">
                    {item.content_rating || 'PG-13'}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    {item.resolution || '4K UHD'}
                  </span>
                  {item.hdr_format && item.hdr_format !== 'SDR' && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-400/20 text-amber-300 border border-amber-400/30 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-amber-300" />
                      {item.hdr_format}
                    </span>
                  )}
                  {item.rating > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/10 text-amber-300 border border-white/15 flex items-center gap-1">
                      <Star className="w-3 h-3 fill-amber-300" />
                      {item.rating.toFixed(1)}
                    </span>
                  )}
                </div>

                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {item.title}
                </h1>

                <div className="flex items-center gap-3 text-xs text-white/50 mt-1">
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {item.release_year}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatDuration(item.duration_seconds)}</span>
                  <span>•</span>
                  <span>{item.director || 'Studio'}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 pt-1">
                <button
                  onClick={() => {
                    const firstEp = item.seasons?.[0]?.episodes?.[0];
                    if (item.type === 'show' && firstEp) {
                      startPlaying({
                        ...item,
                        mediaId: item.id,
                        episodeId: firstEp.id,
                        title: firstEp.title,
                        showTitle: item.title,
                        seasonNumber: 1,
                        episodeNumber: firstEp.episode_number,
                        resolution: firstEp.resolution || item.resolution,
                        hdrFormat: firstEp.hdr_format || item.hdr_format,
                        duration: firstEp.duration_seconds || item.duration_seconds
                      });
                    } else {
                      startPlaying(item);
                    }
                    setDetailModalItem(null);
                  }}
                  className="px-6 py-2.5 rounded-full glass-pill bg-white text-black font-bold text-sm hover:bg-white/90 flex items-center gap-2 shadow-[0_4px_20px_rgba(255,255,255,0.4)] transition-all cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-black" />
                  Play Now
                </button>

                <button
                  type="button"
                  onClick={() => toggleWatchlist(item.id)}
                  className={`px-4 py-2.5 rounded-full glass-pill border font-medium text-xs flex items-center gap-2 transition-all cursor-pointer ${
                    inWatch
                      ? 'bg-blue-600/80 text-white border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.4)]'
                      : 'bg-white/10 hover:bg-white/20 text-white border-white/15'
                  }`}
                >
                  <Bookmark className={`w-3.5 h-3.5 ${inWatch ? 'fill-current' : ''}`} />
                  <span>{inWatch ? 'In Watchlist' : 'Watchlist'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => toggleFavorite(item.id)}
                  className={`px-4 py-2.5 rounded-full glass-pill border font-medium text-xs flex items-center gap-2 transition-all cursor-pointer ${
                    isFav
                      ? 'bg-rose-600/80 text-white border-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                      : 'bg-white/10 hover:bg-white/20 text-white border-white/15'
                  }`}
                >
                  <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-current text-white' : ''}`} />
                  <span>{isFav ? 'Favorited' : 'Favorite'}</span>
                </button>
              </div>

              {/* Plot Synopsis */}
              <p className="text-sm text-white/80 leading-relaxed max-w-2xl">
                {item.overview || 'No synopsis available for this title.'}
              </p>

              {/* Cast Row */}
              {item.cast && item.cast.length > 0 && (
                <div className="pt-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">Cast</h4>
                  <div className="flex items-center gap-3 overflow-x-auto py-1">
                    {item.cast.slice(0, 6).map((c, i) => (
                      <div key={i} className="flex items-center gap-2 pr-3 shrink-0">
                        <img
                          src={c.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'}
                          alt={c.name}
                          className="w-8 h-8 rounded-full object-cover border border-white/20"
                        />
                        <div className="text-left">
                          <p className="text-xs font-medium text-white">{c.name}</p>
                          <p className="text-[10px] text-white/40">{c.role}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* TV Show Season & Episode Guide */}
          {item.type === 'show' && item.seasons && item.seasons.length > 0 && (
            <div className="mt-8 pt-6 border-t border-white/10">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Tv className="w-5 h-5 text-blue-400" />
                  Episodes
                </h3>

                {/* Season Pills */}
                <div className="flex items-center gap-2 overflow-x-auto">
                  {item.seasons.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setActiveSeasonNum(s.season_number)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                        activeSeasonNum === s.season_number
                          ? 'bg-white text-black shadow-sm'
                          : 'bg-white/10 text-white/70 hover:bg-white/20'
                      }`}
                    >
                      {s.title || `Season ${s.season_number}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Episodes List */}
              <div className="space-y-3">
                {currentSeason?.episodes?.map(ep => (
                  <div
                    key={ep.id}
                    onClick={() => {
                      startPlaying({
                        ...item,
                        mediaId: item.id,
                        episodeId: ep.id,
                        title: ep.title,
                        showTitle: item.title,
                        seasonNumber: activeSeasonNum,
                        episodeNumber: ep.episode_number,
                        resolution: ep.resolution,
                        hdrFormat: ep.hdr_format,
                        duration: ep.duration_seconds
                      });
                      setDetailModalItem(null);
                    }}
                    className="flex items-center gap-4 p-3 rounded-2xl glass-card hover:bg-white/10 border border-white/10 cursor-pointer group transition-all"
                  >
                    <div className="relative w-28 sm:w-36 aspect-video rounded-xl overflow-hidden shrink-0 bg-black/40">
                      <img
                        src={ep.still_url || item.backdrop_url}
                        alt={ep.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-8 h-8 rounded-full bg-white/40 backdrop-blur-sm flex items-center justify-center">
                          <Play className="w-4 h-4 fill-white text-white ml-0.5" />
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-white truncate group-hover:text-blue-300">
                          {ep.episode_number}. {ep.title}
                        </h4>
                        <span className="text-xs text-white/40 shrink-0">
                          {formatDuration(ep.duration_seconds)}
                        </span>
                      </div>
                      <p className="text-xs text-white/60 line-clamp-2 mt-1">
                        {ep.overview || `Episode ${ep.episode_number} of Season ${activeSeasonNum}.`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
