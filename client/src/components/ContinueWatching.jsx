import React from 'react';
import { Play, Sparkles } from 'lucide-react';
import { useServer } from '../context/ServerContext.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';

export default function ContinueWatching() {
  const { continueWatching } = useServer();
  const { startPlaying } = usePlayer();

  if (!continueWatching || continueWatching.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4 px-1">
        <h2 className="text-lg font-semibold text-white tracking-tight flex items-center gap-2">
          <span>Continue Watching</span>
          <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-white/10 text-white/60">
            {continueWatching.length}
          </span>
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {continueWatching.map((item, idx) => (
          <div
            key={`${item.mediaId}-${item.episodeId || idx}`}
            onClick={() => startPlaying(item, item.positionSeconds)}
            className="group relative cursor-pointer glass-card overflow-hidden rounded-2xl border border-white/10 hover:border-white/25 transition-all duration-300"
          >
            {/* Backdrop thumbnail */}
            <div className="relative aspect-video w-full overflow-hidden bg-white/5">
              <img
                src={item.backdropUrl || item.posterUrl}
                alt={item.title}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

              {/* Play Icon Overlay */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <div className="w-12 h-12 rounded-full glass-pill bg-white/30 backdrop-blur-md flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
                  <Play className="w-5 h-5 text-white fill-white ml-0.5" />
                </div>
              </div>

              {/* Quality & HDR Pill Badge */}
              <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-black/60 backdrop-blur-md text-white/90 border border-white/15">
                  {item.resolution || '1080p'}
                </span>
                {item.hdrFormat && item.hdrFormat !== 'SDR' && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-white/20 backdrop-blur-md text-white border border-white/25 flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5 text-amber-300" />
                    {item.hdrFormat}
                  </span>
                )}
              </div>

              {/* Frosted Progress Bar */}
              <div className="absolute bottom-0 inset-x-0 h-1.5 bg-black/50">
                <div
                  className="h-full bg-gradient-to-r from-blue-400 to-indigo-300 shadow-[0_0_8px_rgba(129,140,248,0.8)]"
                  style={{ width: `${item.percent}%` }}
                />
              </div>
            </div>

            {/* Info Footer */}
            <div className="p-3">
              <h3 className="font-medium text-sm text-white truncate group-hover:text-blue-300 transition-colors">
                {item.title}
              </h3>
              <p className="text-xs text-white/50 truncate mt-0.5">
                {item.type === 'show' ? `S${item.seasonNumber}:E${item.episodeNumber} • ${item.episodeTitle}` : `${item.releaseYear || ''}`}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
