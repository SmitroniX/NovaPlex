import React from 'react';
import { Play, Sparkles, Star, Heart, Bookmark } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useServer } from '../context/ServerContext.jsx';

export default function MediaCard({ item }) {
  const { startPlaying } = usePlayer();
  const { setDetailModalItem, favorites, watchlist, toggleFavorite, toggleWatchlist } = useServer();

  const isFav = favorites ? favorites.has(item.id) : Boolean(item.is_favorite);
  const inWatch = watchlist ? watchlist.has(item.id) : Boolean(item.in_watchlist);

  const handlePlayClick = (e) => {
    e.stopPropagation();
    startPlaying(item);
  };

  return (
    <div
      onClick={() => setDetailModalItem(item)}
      className="group relative cursor-pointer glass-card overflow-hidden rounded-2xl border border-white/10 hover:border-white/30 transition-all duration-300 flex flex-col"
    >
      {/* Poster Aspect Ratio */}
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-white/5 rounded-t-2xl">
        <img
          src={item.poster_url || item.backdrop_url || 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500'}
          alt={item.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />

        {/* Ambient Dark Gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/20 opacity-80 group-hover:opacity-60 transition-opacity" />

        {/* Badges in Top Right */}
        <div className="absolute top-2.5 right-2.5 flex flex-col items-end gap-1.5 z-10">
          {item.resolution && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-black/60 backdrop-blur-md text-white/90 border border-white/15">
              {item.resolution}
            </span>
          )}
          {item.hdr_format && item.hdr_format !== 'SDR' && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-white/20 backdrop-blur-md text-white border border-white/25 flex items-center gap-1 shadow-sm">
              <Sparkles className="w-2.5 h-2.5 text-amber-300" />
              {item.hdr_format}
            </span>
          )}
        </div>

        {/* Rating in Top Left */}
        {item.rating > 0 && (
          <div className="absolute top-2.5 left-2.5 z-10">
            <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-black/60 backdrop-blur-md text-amber-300 border border-white/15 flex items-center gap-1">
              <Star className="w-2.5 h-2.5 fill-amber-300" />
              {item.rating.toFixed(1)}
            </span>
          </div>
        )}

        {/* Watchlist & Favorites Buttons at Bottom Right */}
        <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 z-10 opacity-70 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleWatchlist(item.id);
            }}
            className={`p-1.5 rounded-full backdrop-blur-md border transition-all cursor-pointer ${
              inWatch
                ? 'bg-blue-600/90 text-white border-blue-400 shadow-sm'
                : 'bg-black/50 hover:bg-black/80 text-white/70 hover:text-white border-white/15'
            }`}
            title={inWatch ? 'In Watchlist' : 'Add to Watchlist'}
          >
            <Bookmark className={`w-3.5 h-3.5 ${inWatch ? 'fill-current' : ''}`} />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleFavorite(item.id);
            }}
            className={`p-1.5 rounded-full backdrop-blur-md border transition-all cursor-pointer ${
              isFav
                ? 'bg-rose-600/90 text-white border-rose-400 shadow-sm'
                : 'bg-black/50 hover:bg-black/80 text-white/70 hover:text-white border-white/15'
            }`}
            title={isFav ? 'Favorited' : 'Add to Favorites'}
          >
            <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-current text-white' : ''}`} />
          </button>
        </div>

        {/* Quick Play Hover Button */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button
            onClick={handlePlayClick}
            className="w-12 h-12 rounded-full glass-pill bg-white/30 backdrop-blur-md flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform hover:bg-white/40"
            title="Play Now"
          >
            <Play className="w-5 h-5 text-white fill-white ml-0.5" />
          </button>
        </div>
      </div>

      {/* Info Section */}
      <div className="p-3 flex-1 flex flex-col justify-between">
        <div>
          <h3 className="font-semibold text-sm text-white truncate group-hover:text-blue-300 transition-colors">
            {item.title}
          </h3>
          <div className="flex items-center gap-2 text-xs text-white/50 mt-1">
            <span>{item.release_year || '2024'}</span>
            <span>•</span>
            <span className="capitalize">{item.type === 'show' ? 'Series' : 'Movie'}</span>
            {item.genres && item.genres[0] && (
              <>
                <span>•</span>
                <span className="truncate">{item.genres[0]}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
