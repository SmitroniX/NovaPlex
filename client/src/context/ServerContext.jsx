import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ServerContext = createContext(null);

export function ServerProvider({ children }) {
  const [users, setUsers] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [libraries, setLibraries] = useState([]);
  const [activeLibraryId, setActiveLibraryId] = useState('all');
  const [mediaItems, setMediaItems] = useState([]);
  const [continueWatching, setContinueWatching] = useState([]);
  const [favorites, setFavorites] = useState(new Set());
  const [watchlist, setWatchlist] = useState(new Set());
  const [settings, setSettings] = useState({});
  const [stats, setStats] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  // Modals & Navigation state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [detailModalItem, setDetailModalItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState({
    genre: 'All',
    resolution: 'All',
    hdr: 'All',
    type: 'all',
    collection: 'all' // 'all', 'favorites', 'watchlist'
  });

  // 1. Fetch Users
  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
        if (!activeUser && data.length > 0) {
          const savedUserId = localStorage.getItem('novaplex_active_user');
          const matched = data.find(u => u.id === savedUserId) || data[0];
          setActiveUser(matched);
        }
      }
    } catch (err) {
      console.warn('Failed to load users:', err);
    }
  };

  // 2. Fetch Libraries
  const fetchLibraries = async () => {
    try {
      const res = await fetch('/api/libraries');
      if (res.ok) {
        const data = await res.json();
        setLibraries(data);
      }
    } catch (err) {
      console.warn('Failed to load libraries:', err);
    }
  };

  // 3. Fetch Media
  const fetchMedia = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();

      if (activeLibraryId !== 'all') {
        params.append('libraryId', activeLibraryId);
      }
      if (activeFilter.type !== 'all') {
        params.append('type', activeFilter.type);
      }
      if (activeFilter.genre !== 'All') {
        params.append('genre', activeFilter.genre);
      }
      if (activeFilter.resolution !== 'All') {
        params.append('resolution', activeFilter.resolution);
      }
      if (activeFilter.hdr !== 'All') {
        params.append('hdr', activeFilter.hdr);
      }
      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }
      if (activeUser?.id) {
        params.append('userId', activeUser.id);
        if (activeFilter.collection === 'favorites') {
          params.append('filter', 'favorites');
        } else if (activeFilter.collection === 'watchlist') {
          params.append('filter', 'watchlist');
        }
      }

      const res = await fetch(`/api/media?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setMediaItems(data);
      }
    } catch (err) {
      console.warn('Failed to load media:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Fetch Continue Watching, Favorites, and Watchlist for active user
  const fetchUserLists = async () => {
    if (!activeUser) return;
    try {
      const [resCont, resFav, resWatch] = await Promise.all([
        fetch(`/api/playback/continue?userId=${activeUser.id}`),
        fetch(`/api/media/user/favorites?userId=${activeUser.id}`),
        fetch(`/api/media/user/watchlist?userId=${activeUser.id}`)
      ]);

      if (resCont.ok) {
        const data = await resCont.json();
        setContinueWatching(data);
      }

      if (resFav.ok) {
        const favs = await resFav.json();
        setFavorites(new Set(favs.map(f => f.id)));
      }

      if (resWatch.ok) {
        const watch = await resWatch.json();
        setWatchlist(new Set(watch.map(w => w.id)));
      }
    } catch (err) {
      console.warn('Failed to load user lists:', err);
    }
  };

  // Toggle Favorite
  const toggleFavorite = async (mediaId) => {
    if (!activeUser || !mediaId) return;

    // Optimistic UI update
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });

    setMediaItems(prev =>
      prev.map(item => item.id === mediaId ? { ...item, is_favorite: !item.is_favorite } : item)
    );

    try {
      const res = await fetch('/api/media/user/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: activeUser.id, mediaId })
      });
      if (res.ok) {
        const data = await res.json();
        setFavorites(prev => {
          const next = new Set(prev);
          if (data.isFavorite) next.add(mediaId);
          else next.delete(mediaId);
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  // Toggle Watchlist
  const toggleWatchlist = async (mediaId) => {
    if (!activeUser || !mediaId) return;

    // Optimistic UI update
    setWatchlist(prev => {
      const next = new Set(prev);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });

    setMediaItems(prev =>
      prev.map(item => item.id === mediaId ? { ...item, in_watchlist: !item.in_watchlist } : item)
    );

    try {
      const res = await fetch('/api/media/user/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: activeUser.id, mediaId })
      });
      if (res.ok) {
        const data = await res.json();
        setWatchlist(prev => {
          const next = new Set(prev);
          if (data.inWatchlist) next.add(mediaId);
          else next.delete(mediaId);
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to toggle watchlist:', err);
    }
  };

  // 5. Fetch Settings & Stats
  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings || {});
        setStats(data.stats || {});
      }
    } catch (err) {
      console.warn('Failed to load settings:', err);
    }
  };

  // Initial Load
  useEffect(() => {
    Promise.all([fetchUsers(), fetchLibraries(), fetchSettings()]).finally(() => {
      fetchMedia();
    });

    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('system') === 'true' || params.get('settings') === 'true') {
        setIsSettingsOpen(true);
      } else if (params.get('search') === 'true') {
        setIsSearchOpen(true);
      }
    } catch (_) {}
  }, []);

  // Update media when library, filters, or activeUser changes
  useEffect(() => {
    fetchMedia();
  }, [activeLibraryId, activeFilter, searchQuery, activeUser]);

  // Update user lists when activeUser changes
  useEffect(() => {
    if (activeUser) {
      localStorage.setItem('novaplex_active_user', activeUser.id);
      fetchUserLists();
    }
  }, [activeUser]);

  const switchUser = (user) => {
    setActiveUser(user);
    localStorage.setItem('novaplex_active_user', user.id);
    setIsUserModalOpen(false);
  };

  const scanLibrary = async (libId) => {
    try {
      const res = await fetch(`/api/libraries/${libId}/scan`, { method: 'POST' });
      if (res.ok) {
        setTimeout(() => {
          fetchMedia();
          fetchLibraries();
        }, 1500);
      }
    } catch (err) {
      console.error('Scan error:', err);
    }
  };

  return (
    <ServerContext.Provider value={{
      users,
      activeUser,
      switchUser,
      libraries,
      activeLibraryId,
      setActiveLibraryId,
      mediaItems,
      continueWatching,
      fetchContinueWatching: fetchUserLists,
      favorites,
      watchlist,
      toggleFavorite,
      toggleWatchlist,
      settings,
      stats,
      isLoading,
      fetchMedia,
      scanLibrary,
      fetchLibraries,
      fetchSettings,
      isSettingsOpen,
      setIsSettingsOpen,
      isUserModalOpen,
      setIsUserModalOpen,
      isSearchOpen,
      setIsSearchOpen,
      detailModalItem,
      setDetailModalItem,
      searchQuery,
      setSearchQuery,
      activeFilter,
      setActiveFilter
    }}>
      {children}
    </ServerContext.Provider>
  );
}

export function useServer() {
  const context = useContext(ServerContext);
  if (!context) throw new Error('useServer must be used within ServerProvider');
  return context;
}
