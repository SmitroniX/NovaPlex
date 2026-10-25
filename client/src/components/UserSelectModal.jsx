import React, { useState } from 'react';
import { X, Lock, Check, UserPlus } from 'lucide-react';
import { useServer } from '../context/ServerContext.jsx';

export default function UserSelectModal() {
  const {
    isUserModalOpen,
    setIsUserModalOpen,
    users,
    switchUser,
    activeUser
  } = useServer();

  const [selectedProfile, setSelectedProfile] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPin, setNewPin] = useState('');

  if (!isUserModalOpen) return null;

  const handleProfileClick = (user) => {
    if (user.has_pin) {
      setSelectedProfile(user);
      setPinInput('');
      setPinError('');
    } else {
      switchUser(user);
    }
  };

  const handlePinSubmit = async (e) => {
    e.preventDefault();
    if (!selectedProfile) return;

    try {
      const res = await fetch('/api/users/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedProfile.id, pin: pinInput })
      });

      if (res.ok) {
        const data = await res.json();
        switchUser(data.user);
        setSelectedProfile(null);
      } else {
        setPinError('Incorrect PIN. Please try again.');
        setPinInput('');
      }
    } catch (err) {
      setPinError('Authentication error');
    }
  };

  const handleCreateProfile = async (e) => {
    e.preventDefault();
    if (!newUsername.trim()) return;

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          pin: newPin.trim(),
          avatar: `https://images.unsplash.com/photo-${1535713875002 + Math.floor(Math.random() * 50)}?w=200`
        })
      });

      if (res.ok) {
        const user = await res.json();
        setIsCreating(false);
        switchUser(user);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/85 backdrop-blur-3xl transition-opacity"
        onClick={() => {
          setIsUserModalOpen(false);
          setSelectedProfile(null);
        }}
      />

      <div className="relative w-full max-w-md rounded-3xl glass-modal bg-[#10131c]/90 border border-white/20 p-8 z-10 text-center shadow-2xl">
        <button
          onClick={() => {
            setIsUserModalOpen(false);
            setSelectedProfile(null);
          }}
          className="absolute top-4 right-4 p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/70 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>

        {!selectedProfile && !isCreating ? (
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Who's Watching?</h2>
            <p className="text-xs text-white/50 mb-8">Select a profile to access your watch history and recommendations</p>

            <div className="flex flex-wrap items-center justify-center gap-6 mb-8">
              {users.map(u => (
                <div
                  key={u.id}
                  onClick={() => handleProfileClick(u)}
                  className="flex flex-col items-center gap-2 group cursor-pointer"
                >
                  <div className="relative">
                    <img
                      src={u.avatar}
                      alt={u.username}
                      className={`w-20 h-20 rounded-full object-cover border-2 transition-all duration-200 group-hover:scale-105 ${
                        activeUser?.id === u.id ? 'border-blue-400 shadow-[0_0_20px_rgba(96,165,250,0.5)]' : 'border-white/20 group-hover:border-white/50'
                      }`}
                    />
                    {u.has_pin && (
                      <div className="absolute bottom-0 right-0 p-1.5 rounded-full bg-black/80 border border-white/20">
                        <Lock className="w-3 h-3 text-white/70" />
                      </div>
                    )}
                  </div>
                  <span className="text-sm font-medium text-white/80 group-hover:text-white">
                    {u.username}
                  </span>
                </div>
              ))}

              {/* Add Profile button */}
              <div
                onClick={() => setIsCreating(true)}
                className="flex flex-col items-center gap-2 group cursor-pointer"
              >
                <div className="w-20 h-20 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center group-hover:border-white/50 group-hover:scale-105 transition-all">
                  <UserPlus className="w-6 h-6 text-white/40 group-hover:text-white" />
                </div>
                <span className="text-sm font-medium text-white/60 group-hover:text-white">
                  Add Profile
                </span>
              </div>
            </div>
          </div>
        ) : selectedProfile ? (
          /* PIN Input Screen */
          <form onSubmit={handlePinSubmit} className="space-y-4">
            <img
              src={selectedProfile.avatar}
              alt={selectedProfile.username}
              className="w-16 h-16 rounded-full mx-auto object-cover border-2 border-white/30"
            />
            <h3 className="text-lg font-bold text-white">Enter PIN for {selectedProfile.username}</h3>
            <p className="text-xs text-white/50">This profile is PIN protected</p>

            <input
              type="password"
              maxLength="6"
              autoFocus
              value={pinInput}
              onChange={e => setPinInput(e.target.value)}
              placeholder="••••"
              className="w-40 mx-auto block px-4 py-2 text-center text-2xl tracking-[0.5em] font-mono rounded-xl bg-black/50 border border-white/20 text-white focus:outline-none focus:border-blue-400"
            />

            {pinError && <p className="text-xs text-rose-400">{pinError}</p>}

            <div className="flex justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedProfile(null)}
                className="px-4 py-2 rounded-full text-xs text-white/60 hover:text-white"
              >
                Back
              </button>
              <button
                type="submit"
                className="px-6 py-2 rounded-full glass-pill bg-white text-black font-semibold text-xs hover:bg-white/90"
              >
                Unlock
              </button>
            </div>
          </form>
        ) : (
          /* Create Profile Screen */
          <form onSubmit={handleCreateProfile} className="space-y-4 text-left">
            <h3 className="text-lg font-bold text-white text-center">New Profile</h3>
            <div>
              <label className="block text-xs text-white/60 mb-1">Profile Name</label>
              <input
                type="text"
                placeholder="e.g. Guest, Kids"
                value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-xs text-white focus:outline-none focus:border-white/40"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">PIN (Optional)</label>
              <input
                type="password"
                maxLength="4"
                placeholder="Optional 4-digit PIN"
                value={newPin}
                onChange={e => setNewPin(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-xs text-white focus:outline-none focus:border-white/40"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-4 py-2 rounded-full text-xs text-white/60 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-6 py-2 rounded-full glass-pill bg-white text-black font-bold text-xs"
              >
                Create
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
