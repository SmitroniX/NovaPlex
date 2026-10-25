import React from 'react';
import { Sparkles, SlidersHorizontal, FolderPlus, Heart, Bookmark, Film } from 'lucide-react';
import { useServer } from '../context/ServerContext.jsx';
import MediaCard from './MediaCard.jsx';
import ContinueWatching from './ContinueWatching.jsx';

const GENRES = ['All', 'Action', 'Drama', 'Sci-Fi', 'Thriller', 'Comedy', 'Adventure', 'Animation'];
const RESOLUTIONS = ['All', '4K UHD', '1080p FHD', '720p HD'];
const HDR_TYPES = ['All', 'HDR10+', 'HDR10', 'HLG', 'SDR'];

export default function LibraryView() {
  const {
    mediaItems,
    isLoading,
    activeFilter,
    setActiveFilter,
    setIsSettingsOpen
  } = useServer();

  const handleCollectionSelect = (collection) => {
    setActiveFilter(prev => ({ ...prev, collection }));
  };

  const handleGenreSelect = (genre) => {
    setActiveFilter(prev => ({ ...prev, genre }));
  };

  const handleResolutionSelect = (resolution) => {
    setActiveFilter(prev => ({ ...prev, resolution }));
  };

  const handleHdrSelect = (hdr) => {
    setActiveFilter(prev => ({ ...prev, hdr }));
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 pt-20 sm:pt-24 pb-16">
      {/* Continue Watching Section */}
      <ContinueWatching />

      {/* Filter Bar with Apple Liquid Glass Pills */}
      <div className="mb-6 sm:mb-8 space-y-2.5 sm:space-y-3">
        {/* Collection & Category Row */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 text-xs">
          <button
            onClick={() => handleCollectionSelect('all')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
              (activeFilter.collection || 'all') === 'all'
                ? 'bg-white text-black shadow-[0_2px_14px_rgba(255,255,255,0.45)]'
                : 'bg-white/[0.08] hover:bg-white/[0.15] text-white/80 hover:text-white border border-white/10'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            All Titles
          </button>

          <button
            onClick={() => handleCollectionSelect('favorites')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
              activeFilter.collection === 'favorites'
                ? 'bg-rose-500 text-white shadow-[0_2px_14px_rgba(244,63,94,0.5)] border border-rose-400'
                : 'bg-white/[0.08] hover:bg-white/[0.15] text-white/80 hover:text-white border border-white/10'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${activeFilter.collection === 'favorites' ? 'fill-white' : 'text-rose-400'}`} />
            Favorites
          </button>

          <button
            onClick={() => handleCollectionSelect('watchlist')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
              activeFilter.collection === 'watchlist'
                ? 'bg-blue-600 text-white shadow-[0_2px_14px_rgba(37,99,235,0.5)] border border-blue-400'
                : 'bg-white/[0.08] hover:bg-white/[0.15] text-white/80 hover:text-white border border-white/10'
            }`}
          >
            <Bookmark className={`w-3.5 h-3.5 ${activeFilter.collection === 'watchlist' ? 'fill-white' : 'text-blue-400'}`} />
            Watchlist
          </button>
        </div>

        {/* Genre Row */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 text-xs">
          <span className="font-medium text-white/40 mr-1 flex items-center gap-1 shrink-0">
            <SlidersHorizontal className="w-3 h-3" />
            Genre:
          </span>
          {GENRES.map(g => (
            <button
              key={g}
              onClick={() => handleGenreSelect(g)}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200 cursor-pointer ${
                activeFilter.genre === g
                  ? 'bg-white text-black font-semibold shadow-[0_2px_12px_rgba(255,255,255,0.4)]'
                  : 'bg-white/[0.06] hover:bg-white/[0.12] text-white/70 hover:text-white border border-white/10'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        {/* Quality & HDR Toggle Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1.5 border-t border-white/[0.08]">
          {/* Resolution pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <span className="text-xs font-medium text-white/40 mr-1 shrink-0">Resolution:</span>
            {RESOLUTIONS.map(r => (
              <button
                key={r}
                onClick={() => handleResolutionSelect(r)}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer ${
                  activeFilter.resolution === r
                    ? 'bg-white/25 text-white border border-white/40 shadow-sm'
                    : 'bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08] border border-white/10'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* HDR Filter pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <span className="text-xs font-medium text-white/40 mr-1 flex items-center gap-1 shrink-0">
              <Sparkles className="w-3 h-3 text-amber-300/80" />
              Dynamic Range:
            </span>
            {HDR_TYPES.map(h => (
              <button
                key={h}
                onClick={() => handleHdrSelect(h)}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer ${
                  activeFilter.hdr === h
                    ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40 shadow-sm'
                    : 'bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08] border border-white/10'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Media Catalog Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="aspect-[2/3] rounded-2xl bg-white/5 animate-pulse border border-white/5" />
          ))}
        </div>
      ) : mediaItems.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {mediaItems.map(item => (
            <MediaCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="py-20 text-center glass-card max-w-lg mx-auto p-8 rounded-3xl border border-white/10">
          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4 border border-white/15">
            <FolderPlus className="w-8 h-8 text-white/70" />
          </div>
          <h3 className="text-base font-bold text-white mb-1">
            {activeFilter.collection === 'favorites'
              ? 'No Favorites Yet'
              : activeFilter.collection === 'watchlist'
                ? 'Your Watchlist is Empty'
                : 'No Media Found'}
          </h3>
          <p className="text-xs text-white/50 mb-6">
            {activeFilter.collection === 'favorites'
              ? 'Tap the heart icon on any title to add it to your favorites.'
              : activeFilter.collection === 'watchlist'
                ? 'Tap the bookmark icon on any title to save it for later.'
                : 'No items matched the selected filters. Try resetting the filters or scan your media libraries.'}
          </p>
          <button
            onClick={() => {
              if (activeFilter.collection !== 'all') {
                setActiveFilter(prev => ({ ...prev, collection: 'all' }));
              } else {
                setIsSettingsOpen(true);
              }
            }}
            className="px-5 py-2.5 rounded-full glass-pill bg-white text-black text-xs font-bold hover:bg-white/90 shadow-md cursor-pointer"
          >
            {activeFilter.collection !== 'all' ? 'View All Titles' : 'Open Server Dashboard'}
          </button>
        </div>
      )}
    </div>
  );
}
