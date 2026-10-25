import React, { useEffect, useRef } from 'react';
import { Search, X, Film, Tv, Play, Sparkles } from 'lucide-react';
import { useServer } from '../context/ServerContext.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';

export default function SearchModal() {
  const {
    isSearchOpen,
    setIsSearchOpen,
    searchQuery,
    setSearchQuery,
    mediaItems,
    setDetailModalItem
  } = useServer();

  const { startPlaying } = usePlayer();
  const inputRef = useRef(null);

  useEffect(() => {
    if (isSearchOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isSearchOpen]);

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(prev => !prev);
      } else if (e.key === 'Escape' && isSearchOpen) {
        setIsSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen]);

  if (!isSearchOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-20">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/85 backdrop-blur-3xl transition-opacity"
        onClick={() => setIsSearchOpen(false)}
      />

      <div className="relative w-full max-w-2xl rounded-3xl glass-modal bg-[#10131c]/95 border border-white/20 p-4 sm:p-6 z-10 shadow-2xl flex flex-col max-h-[80vh]">
        
        {/* Search Bar Input */}
        <div className="relative flex items-center mb-4">
          <Search className="w-5 h-5 text-white/50 absolute left-4 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search movies, TV shows, cast, directors..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-10 py-3 rounded-2xl bg-white/[0.06] border border-white/15 text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/40"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 p-1 rounded-full text-white/40 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 no-scrollbar">
          {mediaItems.length > 0 ? (
            mediaItems.map(item => (
              <div
                key={item.id}
                onClick={() => {
                  setDetailModalItem(item);
                  setIsSearchOpen(false);
                }}
                className="flex items-center justify-between p-3 rounded-2xl glass-card hover:bg-white/10 border border-white/10 cursor-pointer group transition-all"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={item.poster_url || item.backdrop_url}
                    alt={item.title}
                    className="w-12 h-16 rounded-xl object-cover shrink-0 border border-white/15"
                  />
                  <div>
                    <h4 className="font-semibold text-sm text-white group-hover:text-blue-300">
                      {item.title}
                    </h4>
                    <p className="text-xs text-white/50 flex items-center gap-2 mt-0.5">
                      <span>{item.release_year || '2024'}</span>
                      <span>•</span>
                      <span className="capitalize">{item.type}</span>
                      <span>•</span>
                      <span>{item.resolution || '1080p'}</span>
                      {item.hdr_format && item.hdr_format !== 'SDR' && (
                        <span className="flex items-center gap-0.5 text-amber-300">
                          <Sparkles className="w-2.5 h-2.5" /> {item.hdr_format}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startPlaying(item);
                    setIsSearchOpen(false);
                  }}
                  className="p-2.5 rounded-full bg-white/10 hover:bg-white/30 text-white"
                  title="Play"
                >
                  <Play className="w-4 h-4 fill-white" />
                </button>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-white/40 text-sm">
              {searchQuery ? `No titles found matching "${searchQuery}"` : 'Type to search your libraries...'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
