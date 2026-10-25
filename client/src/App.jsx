import React from 'react';
import { ServerProvider } from './context/ServerContext.jsx';
import { PlayerProvider } from './context/PlayerContext.jsx';
import LiquidBackground from './components/LiquidBackground.jsx';
import Navbar from './components/Navbar.jsx';
import LibraryView from './components/LibraryView.jsx';
import MediaDetailModal from './components/MediaDetailModal.jsx';
import NovaPlayer from './components/NovaPlayer.jsx';
import ServerSettings from './components/ServerSettings.jsx';
import UserSelectModal from './components/UserSelectModal.jsx';
import SearchModal from './components/SearchModal.jsx';

export default function App() {
  return (
    <ServerProvider>
      <PlayerProvider>
        <div className="relative min-h-screen text-white flex flex-col selection:bg-white/20">
          {/* Ambient Liquid Glass Mesh Background */}
          <LiquidBackground />

          {/* Floating Glass Pill Navigation */}
          <Navbar />

          {/* Main Media Library Grid */}
          <main className="flex-1">
            <LibraryView />
          </main>

          {/* Modals & Player Chrome */}
          <MediaDetailModal />
          <NovaPlayer />
          <ServerSettings />
          <UserSelectModal />
          <SearchModal />
        </div>
      </PlayerProvider>
    </ServerProvider>
  );
}
