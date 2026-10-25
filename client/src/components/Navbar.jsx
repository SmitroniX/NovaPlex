import React from 'react';
import { Film, Tv, LayoutGrid, Search, Settings, Sparkles, Activity } from 'lucide-react';
import { useServer } from '../context/ServerContext.jsx';

export default function Navbar() {
  const {
    activeFilter,
    setActiveFilter,
    setIsSearchOpen,
    setIsSettingsOpen,
    setIsUserModalOpen,
    activeUser
  } = useServer();

  const handleTypeChange = (type) => {
    setActiveFilter(prev => ({ ...prev, type }));
  };

  return (
    <header className="fixed top-2 sm:top-4 inset-x-0 z-40 flex justify-center px-2 sm:px-4 pointer-events-none">
      <nav className="pointer-events-auto flex items-center justify-between w-full max-w-6xl px-2.5 sm:px-4 py-1.5 sm:py-2 glass-pill bg-white/[0.08] backdrop-blur-3xl border border-white/[0.18] shadow-[0_16px_40px_rgba(0,0,0,0.6)]">
        
        {/* Brand Logo */}
        <div className="flex items-center gap-2 sm:gap-3 pl-1 shrink-0">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-tr from-white/25 to-white/5 border border-white/25 flex items-center justify-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]">
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
          </div>
          <span className="font-bold text-sm sm:text-base tracking-tight text-white flex items-center gap-1.5">
            NovaPlex
            <span className="hidden md:inline-block text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full bg-white/10 text-white/70 border border-white/15">
              4K HDR
            </span>
          </span>
        </div>

        {/* Center Navigation Pills (Icon only on mobile, text on tablet/desktop) */}
        <div className="flex items-center gap-0.5 sm:gap-1 p-0.5 sm:p-1 rounded-full bg-black/30 border border-white/10 shrink-0">
          <button
            onClick={() => handleTypeChange('all')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer ${
              activeFilter.type === 'all'
                ? 'bg-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
            title="All Media Catalog"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Home</span>
          </button>

          <button
            onClick={() => handleTypeChange('movie')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer ${
              activeFilter.type === 'movie'
                ? 'bg-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
            title="Movies Catalog"
          >
            <Film className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Movies</span>
          </button>

          <button
            onClick={() => handleTypeChange('show')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer ${
              activeFilter.type === 'show'
                ? 'bg-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
            title="TV Shows Catalog"
          >
            <Tv className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">TV Shows</span>
          </button>
        </div>

        {/* Right Action Pills */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Quick Search */}
          <button
            onClick={() => setIsSearchOpen(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white/70 hover:text-white text-xs transition-all cursor-pointer"
            title="Search (Ctrl+K)"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Search</span>
            <kbd className="hidden lg:inline-block px-1.5 py-0.2 text-[9px] font-mono bg-white/10 rounded border border-white/15 text-white/60">
              ⌘K
            </kbd>
          </button>

          {/* System & Server Settings Dashboard */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.16] border border-white/15 text-white/90 hover:text-white text-xs transition-all cursor-pointer shadow-sm"
            title="System & Server Dashboard"
          >
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden xs:inline font-semibold">System</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </button>

          {/* User Profile Switcher */}
          <button
            onClick={() => setIsUserModalOpen(true)}
            className="flex items-center gap-1.5 p-0.5 sm:pl-1 sm:pr-2.5 sm:py-1 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white transition-all cursor-pointer"
            title="Switch User Profile"
          >
            <img
              src={activeUser?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'}
              alt={activeUser?.username || 'User'}
              className="w-5 h-5 sm:w-6 sm:h-6 rounded-full object-cover border border-white/20"
            />
            <span className="text-xs font-medium hidden sm:inline text-white/90">
              {activeUser?.username || 'Profile'}
            </span>
          </button>
        </div>
      </nav>
    </header>
  );
}
