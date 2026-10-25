import React, { useState, useEffect, useCallback } from 'react';
import {
  Server, Cpu, Activity, HardDrive, Play, Square,
  Trash2, RefreshCw, Sliders, X, Check, Sparkles,
  Layers, FolderPlus, Film, Tv, Clock, Database, AlertCircle,
  Cloud, ShieldCheck, ExternalLink, PlusCircle, Radio, Heart
} from 'lucide-react';
import { useServer } from '../context/ServerContext.jsx';

export default function ServerSettings() {
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    libraries,
    scanLibrary,
    settings,
    stats,
    fetchSettings,
    fetchLibraries
  } = useServer();

  const [activeTab, setActiveTab] = useState('health'); // 'health', 'sessions', 'libraries', 'cloud', 'config'
  const [telemetry, setTelemetry] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [quickActionNotice, setQuickActionNotice] = useState(null);

  // Gofile Cloud & Keep-Alive state
  const [gofileStatus, setGofileStatus] = useState(null);
  const [isPingingHeartbeat, setIsPingingHeartbeat] = useState(false);
  const [isAddingCloud, setIsAddingCloud] = useState(false);
  const [cloudForm, setCloudForm] = useState({ title: '', year: '', streamUrl: '', libraryType: 'movie' });
  const [gofileTokenInput, setGofileTokenInput] = useState('');

  // Library add state
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderPath, setNewFolderPath] = useState('');
  const [newFolderType, setNewFolderType] = useState('movie');
  const [isScanningId, setIsScanningId] = useState(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Form settings state
  const [formSettings, setFormSettings] = useState({
    server_name: settings.server_name || 'NovaPlex Apple Media Server',
    transcode_default_quality: settings.transcode_default_quality || 'direct',
    hdr_tonemap_mode: settings.hdr_tonemap_mode || 'auto',
    tmdb_api_key: settings.tmdb_api_key || ''
  });

  // Fetch real-time dashboard telemetry from backend
  const fetchDashboardTelemetry = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/system/dashboard');
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
      }
    } catch (err) {
      console.warn('Failed to load system telemetry:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Fetch Gofile status
  const fetchGofileStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/gofile/status');
      if (res.ok) {
        const data = await res.json();
        setGofileStatus(data);
        if (data.token) {
          setGofileTokenInput(data.token);
        }
      }
    } catch (err) {
      console.warn('Failed to load Gofile status:', err);
    }
  }, []);

  // Poll telemetry every 4 seconds when modal is open
  useEffect(() => {
    if (isSettingsOpen) {
      fetchDashboardTelemetry();
      fetchGofileStatus();
      const interval = setInterval(fetchDashboardTelemetry, 4000);
      return () => clearInterval(interval);
    }
  }, [isSettingsOpen, fetchDashboardTelemetry, fetchGofileStatus]);

  // Sync settings when opened
  useEffect(() => {
    if (settings && Object.keys(settings).length > 0) {
      setFormSettings({
        server_name: settings.server_name || 'NovaPlex Apple Media Server',
        transcode_default_quality: settings.transcode_default_quality || 'direct',
        hdr_tonemap_mode: settings.hdr_tonemap_mode || 'auto',
        tmdb_api_key: settings.tmdb_api_key || ''
      });
    }
  }, [settings]);

  if (!isSettingsOpen) return null;

  const showNotice = (msg) => {
    setQuickActionNotice(msg);
    setTimeout(() => setQuickActionNotice(null), 3000);
  };

  // Quick action handlers
  const handleScanAll = async () => {
    try {
      const res = await fetch('/api/system/scan-all', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        showNotice(data.message || 'Scan initiated for all libraries');
        fetchLibraries();
        setTimeout(fetchDashboardTelemetry, 1500);
      }
    } catch (err) {
      showNotice('Error initiating scan: ' + err.message);
    }
  };

  const handleCleanTranscode = async () => {
    try {
      const res = await fetch('/api/system/clean-transcode', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        showNotice(data.message || 'Transcode cache cleared');
        fetchDashboardTelemetry();
      }
    } catch (err) {
      showNotice('Error cleaning cache: ' + err.message);
    }
  };

  const handleRestartStreamEngine = async () => {
    try {
      const res = await fetch('/api/system/restart-stream-engine', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        showNotice(data.message || 'Streaming engine restarted');
        fetchDashboardTelemetry();
      }
    } catch (err) {
      showNotice('Error restarting engine: ' + err.message);
    }
  };

  const handleTerminateSession = async (sessionKey) => {
    try {
      const res = await fetch('/api/system/terminate-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey })
      });
      if (res.ok) {
        showNotice(`Terminated transcode session: ${sessionKey}`);
        fetchDashboardTelemetry();
      }
    } catch (err) {
      showNotice('Failed to terminate session: ' + err.message);
    }
  };

  const handleAddLibrary = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim() || !newFolderPath.trim()) return;

    try {
      const res = await fetch('/api/libraries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFolderName.trim(),
          type: newFolderType,
          paths: [newFolderPath.trim()]
        })
      });

      if (res.ok) {
        setNewFolderName('');
        setNewFolderPath('');
        fetchLibraries();
        showNotice(`Added library "${newFolderName}"`);
        setTimeout(fetchDashboardTelemetry, 1000);
      }
    } catch (err) {
      showNotice('Error adding library: ' + err.message);
    }
  };

  const handleScanSingle = async (libId) => {
    setIsScanningId(libId);
    await scanLibrary(libId);
    setTimeout(() => {
      setIsScanningId(null);
      fetchDashboardTelemetry();
    }, 2000);
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: formSettings })
      });
      if (res.ok) {
        setSavedSuccess(true);
        fetchSettings();
        showNotice('Settings updated successfully');
        setTimeout(() => setSavedSuccess(false), 2500);
      }
    } catch (err) {
      showNotice('Error saving settings: ' + err.message);
    }
  };

  // Gofile Action Handlers
  const handleTriggerHeartbeat = async () => {
    setIsPingingHeartbeat(true);
    try {
      const res = await fetch('/api/gofile/heartbeat', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        showNotice(`Keep-alive ping acknowledged! ${data.successCount}/${data.totalFiles} cloud stream(s) active.`);
        fetchGofileStatus();
      } else {
        showNotice('Failed to send heartbeat');
      }
    } catch (err) {
      showNotice('Heartbeat error: ' + err.message);
    } finally {
      setIsPingingHeartbeat(false);
    }
  };

  const handleAddCloudMovie = async (e) => {
    e.preventDefault();
    if (!cloudForm.title.trim() || !cloudForm.streamUrl.trim()) return;
    setIsAddingCloud(true);
    try {
      const res = await fetch('/api/gofile/add-strm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cloudForm)
      });
      if (res.ok) {
        const data = await res.json();
        showNotice(data.message || 'Cloud movie added! Scanning metadata...');
        setCloudForm({ title: '', year: '', streamUrl: '', libraryType: 'movie' });
        fetchGofileStatus();
        fetchLibraries();
      } else {
        const err = await res.json();
        showNotice('Failed: ' + (err.error || 'Server error'));
      }
    } catch (err) {
      showNotice('Error: ' + err.message);
    } finally {
      setIsAddingCloud(false);
    }
  };

  const handleSaveGofileToken = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/gofile/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: gofileTokenInput })
      });
      if (res.ok) {
        showNotice('Gofile token saved and linked!');
        fetchGofileStatus();
      }
    } catch (err) {
      showNotice('Failed to save token: ' + err.message);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes <= 0) return '0 MB';
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/85 backdrop-blur-2xl transition-opacity"
        onClick={() => setIsSettingsOpen(false)}
      />

      {/* Main Glassmorphic Dashboard Window */}
      <div className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-3xl glass-modal bg-[#10131c]/95 border border-white/20 shadow-[0_25px_80px_rgba(0,0,0,0.85)] z-10 flex flex-col no-scrollbar">
        
        {/* Sticky Header & Tabs Container */}
        <div className="sticky top-0 z-20 border-b border-white/10 bg-[#10131c]/95 backdrop-blur-3xl">
          <div className="px-4 sm:px-8 py-3.5 sm:py-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-2xl bg-white/10 flex items-center justify-center border border-white/15 shadow-sm shrink-0">
                <Server className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm sm:text-lg md:text-xl font-bold text-white tracking-tight truncate">System & Server Dashboard</h2>
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live
                  </span>
                </div>
                <p className="text-xs text-white/50 hidden xs:block truncate">
                  NovaPlex 4K Ultra HD • HDR10+ • Node.js Native SQLite Engine
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                onClick={fetchDashboardTelemetry}
                disabled={isRefreshing}
                className="p-1.5 sm:p-2 rounded-full glass-pill bg-white/5 hover:bg-white/15 text-white/70 hover:text-white border border-white/10 transition-all cursor-pointer"
                title="Refresh Telemetry"
              >
                <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-1.5 sm:p-2 rounded-full glass-pill bg-white/5 hover:bg-white/15 text-white/70 hover:text-white border border-white/10 transition-all cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            </div>
          </div>

          {/* Quick Action Notification Toast */}
          {quickActionNotice && (
            <div className="mx-4 sm:mx-8 mb-3 p-2.5 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 text-xs text-emerald-200 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{quickActionNotice}</span>
            </div>
          )}

          {/* Navigation Tabs Bar */}
          <div className="px-4 sm:px-8 pb-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveTab('health')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer shrink-0 ${
                activeTab === 'health'
                  ? 'bg-white text-black shadow-md'
                  : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Health & Metrics</span>
            </button>

            <button
              onClick={() => setActiveTab('sessions')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer shrink-0 ${
                activeTab === 'sessions'
                  ? 'bg-white text-black shadow-md'
                  : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Play className="w-3.5 h-3.5" />
              <span>Active Streams</span>
              {telemetry?.transcode?.activeCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-blue-500 text-white text-[10px]">
                  {telemetry.transcode.activeCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('libraries')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer shrink-0 ${
                activeTab === 'libraries'
                  ? 'bg-white text-black shadow-md'
                  : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>Libraries & Storage</span>
            </button>

            <button
              onClick={() => setActiveTab('cloud')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer shrink-0 ${
                activeTab === 'cloud'
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Cloud className="w-3.5 h-3.5 text-blue-300" />
              <span>Gofile Cloud</span>
              {gofileStatus?.cloudFilesCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-white text-[10px] font-bold">
                  {gofileStatus.cloudFilesCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('config')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer shrink-0 ${
                activeTab === 'config'
                  ? 'bg-white text-black shadow-md'
                  : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Engine Settings</span>
            </button>
          </div>
        </div>

        {/* Tab 1: System Health & Telemetry */}
        {activeTab === 'health' && (
          <div className="p-4 sm:p-8 space-y-5 sm:space-y-6 pb-12">
            {/* Quick Metrics 4-Pack */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
              <div className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col justify-between">
                <span className="text-[10px] text-white/50 uppercase font-bold tracking-wider">Server Status</span>
                <p className="text-lg sm:text-xl font-extrabold text-emerald-400 mt-2 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  Online
                </p>
                <p className="text-[11px] text-white/40 mt-1">Uptime: {telemetry?.health?.uptimeFormatted || 'Active'}</p>
              </div>

              <div className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col justify-between">
                <span className="text-[10px] text-white/50 uppercase font-bold tracking-wider">CPU Cores</span>
                <p className="text-lg sm:text-xl font-extrabold text-white mt-2">
                  {telemetry?.hardware?.cpuCores || 2} <span className="text-xs font-normal text-white/50">Cores</span>
                </p>
                <p className="text-[11px] text-white/40 mt-1 truncate">{telemetry?.hardware?.cpuModel || 'ARM64 / x86_64'}</p>
              </div>

              <div className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col justify-between">
                <span className="text-[10px] text-white/50 uppercase font-bold tracking-wider">System Memory</span>
                <p className="text-lg sm:text-xl font-extrabold text-white mt-2">
                  {telemetry?.memory?.percentUsed || 0}%
                </p>
                <p className="text-[11px] text-white/40 mt-1 truncate">
                  {formatBytes(telemetry?.memory?.usedBytes)} / {formatBytes(telemetry?.memory?.totalBytes)}
                </p>
              </div>

              <div className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col justify-between">
                <span className="text-[10px] text-white/50 uppercase font-bold tracking-wider">Transcode Buffer</span>
                <p className="text-lg sm:text-xl font-extrabold text-blue-400 mt-2">
                  {formatBytes(telemetry?.storage?.transcodeBytes)}
                </p>
                <p className="text-[11px] text-white/40 mt-1">
                  {telemetry?.transcode?.activeCount || 0} Active Session(s)
                </p>
              </div>
            </div>

            {/* Hardware & CPU Performance Details */}
            <div className="p-4 sm:p-5 rounded-2xl bg-white/[0.04] border border-white/10 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-blue-400" />
                  Host Processing & Workload
                </h3>
                <span className="text-[11px] text-white/50 font-mono">
                  {telemetry?.hardware?.platform} ({telemetry?.hardware?.arch}) • Node {telemetry?.hardware?.nodeVersion}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <div className="p-2.5 sm:p-3 rounded-xl bg-black/30 border border-white/10 text-center sm:text-left">
                  <span className="text-[9px] sm:text-[10px] text-white/40 uppercase font-semibold block truncate">1m Load</span>
                  <p className="text-base sm:text-lg font-bold text-white mt-0.5">{telemetry?.hardware?.loadAvg?.[0] ?? '0.00'}</p>
                </div>
                <div className="p-2.5 sm:p-3 rounded-xl bg-black/30 border border-white/10 text-center sm:text-left">
                  <span className="text-[9px] sm:text-[10px] text-white/40 uppercase font-semibold block truncate">5m Load</span>
                  <p className="text-base sm:text-lg font-bold text-white mt-0.5">{telemetry?.hardware?.loadAvg?.[1] ?? '0.00'}</p>
                </div>
                <div className="p-2.5 sm:p-3 rounded-xl bg-black/30 border border-white/10 text-center sm:text-left">
                  <span className="text-[9px] sm:text-[10px] text-white/40 uppercase font-semibold block truncate">15m Load</span>
                  <p className="text-base sm:text-lg font-bold text-white mt-0.5">{telemetry?.hardware?.loadAvg?.[2] ?? '0.00'}</p>
                </div>
              </div>

              {/* Memory Visual Bar */}
              <div>
                <div className="flex justify-between text-xs text-white/60 mb-1.5">
                  <span>RAM Utilization</span>
                  <span>{formatBytes(telemetry?.memory?.usedBytes)} used of {formatBytes(telemetry?.memory?.totalBytes)} ({telemetry?.memory?.percentUsed}%)</span>
                </div>
                <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 via-blue-400 to-indigo-400 transition-all duration-500 rounded-full"
                    style={{ width: `${Math.min(100, telemetry?.memory?.percentUsed || 0)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-white/40 mt-1">
                  <span>Process RSS: {formatBytes(telemetry?.memory?.processRssBytes)}</span>
                  <span>Process Heap: {formatBytes(telemetry?.memory?.processHeapUsedBytes)}</span>
                </div>
              </div>
            </div>

            {/* Quick Server Control Actions */}
            <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/10 space-y-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                Quick Server Operations
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  onClick={handleScanAll}
                  className="p-3 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white text-xs font-semibold border border-white/15 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Scan All Libraries
                </button>

                <button
                  onClick={handleCleanTranscode}
                  className="p-3 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white text-xs font-semibold border border-white/15 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-amber-300" />
                  Clean Transcode Cache
                </button>

                <button
                  onClick={handleRestartStreamEngine}
                  className="p-3 rounded-xl bg-red-500/15 hover:bg-red-500/25 active:scale-95 text-red-300 text-xs font-semibold border border-red-500/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-red-400" />
                  Restart Stream Engine
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Active Streams & Transcode Sessions */}
        {activeTab === 'sessions' && (
          <div className="p-4 sm:p-8 space-y-5 pb-16">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white tracking-tight">Active HLS Transcode Pipeline</h3>
                <p className="text-xs text-white/50">Live hardware & software streaming sessions currently in progress</p>
              </div>
              <button
                onClick={fetchDashboardTelemetry}
                className="px-3 py-1.5 rounded-full glass-pill bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 border border-white/15 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            {telemetry?.transcode?.activeSessions && telemetry.transcode.activeSessions.length > 0 ? (
              <div className="space-y-3">
                {telemetry.transcode.activeSessions.map((sess) => (
                  <div
                    key={sess.key}
                    className="p-4 rounded-2xl bg-white/[0.05] border border-white/15 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white truncate">{sess.mediaTitle}</span>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 shrink-0">
                          {sess.quality?.toUpperCase() || 'DIRECT'}
                        </span>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                          {sess.hdrMode}
                        </span>
                      </div>
                      <p className="text-xs text-white/50 font-mono truncate">
                        Key: {sess.key}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-white/40 pt-1">
                        <span>Uptime: {sess.uptimeSeconds || 0}s</span>
                        <span>•</span>
                        <span>PID: {sess.pid || 'Active'}</span>
                        <span>•</span>
                        <span className="text-emerald-400 font-semibold">Active Streaming</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleTerminateSession(sess.key)}
                      className="px-3.5 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/40 text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-all cursor-pointer"
                    >
                      <Square className="w-3.5 h-3.5 fill-red-300" />
                      Terminate Session
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-16 text-center rounded-2xl bg-white/[0.02] border border-white/10 p-8 space-y-3">
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mx-auto border border-white/15">
                  <Play className="w-5 h-5 text-white/60" />
                </div>
                <h4 className="text-sm font-semibold text-white">No Active Transcode Sessions</h4>
                <p className="text-xs text-white/40 max-w-sm mx-auto">
                  The FFmpeg transcoding engine is currently idle. CPU overhead is at 0%. Sessions will appear here automatically when clients start watching.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Libraries & Storage */}
        {activeTab === 'libraries' && (
          <div className="p-4 sm:p-8 space-y-6 pb-16">
            {/* Storage Usage Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
              <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10">
                <span className="text-[10px] text-white/50 uppercase font-bold">Movies Storage</span>
                <p className="text-lg font-bold text-white mt-1">{formatBytes(telemetry?.storage?.moviesBytes)}</p>
                <p className="text-[11px] text-white/40 mt-0.5">{telemetry?.catalog?.totalMovies || 0} titles</p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10">
                <span className="text-[10px] text-white/50 uppercase font-bold">TV Shows Storage</span>
                <p className="text-lg font-bold text-white mt-1">{formatBytes(telemetry?.storage?.showsBytes)}</p>
                <p className="text-[11px] text-white/40 mt-0.5">{telemetry?.catalog?.totalShows || 0} series ({telemetry?.catalog?.totalEpisodes || 0} eps)</p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10">
                <span className="text-[10px] text-white/50 uppercase font-bold">Image Artwork Cache</span>
                <p className="text-lg font-bold text-white mt-1">{formatBytes(telemetry?.storage?.imageCacheBytes)}</p>
                <p className="text-[11px] text-white/40 mt-0.5">Posters & Stills</p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10">
                <span className="text-[10px] text-white/50 uppercase font-bold">SQLite DB Size</span>
                <p className="text-lg font-bold text-white mt-1">{formatBytes(telemetry?.storage?.dbBytes)}</p>
                <p className="text-[11px] text-white/40 mt-0.5">Native node:sqlite</p>
              </div>
            </div>

            {/* Configured Media Libraries List */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider text-white/70">
                Configured Library Folders
              </h3>

              <div className="space-y-2">
                {libraries.map(lib => (
                  <div
                    key={lib.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-white">{lib.name}</span>
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-white/10 text-white/70 border border-white/10">
                          {lib.type}
                        </span>
                        <span className="text-xs text-white/40">({lib.itemCount || 0} items)</span>
                      </div>
                      <p className="text-xs text-white/40 font-mono mt-0.5 truncate max-w-md">
                        {lib.paths?.join(', ')}
                      </p>
                    </div>

                    <button
                      onClick={() => handleScanSingle(lib.id)}
                      disabled={isScanningId === lib.id}
                      className="px-3.5 py-1.5 rounded-full glass-pill text-xs font-semibold flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white border border-white/15 cursor-pointer shrink-0"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isScanningId === lib.id ? 'animate-spin' : ''}`} />
                      <span>{isScanningId === lib.id ? 'Scanning...' : 'Scan Folder'}</span>
                    </button>
                  </div>
                ))}
              </div>

              {/* Add New Folder Form */}
              <form onSubmit={handleAddLibrary} className="pt-3 flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="Library Name (e.g. 4K HDR Movies)"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/40"
                />
                <input
                  type="text"
                  placeholder="/home/ubuntu/NovaPlex/media/movies"
                  value={newFolderPath}
                  onChange={e => setNewFolderPath(e.target.value)}
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-xs text-white font-mono placeholder-white/40 focus:outline-none focus:border-white/40"
                />
                <select
                  value={newFolderType}
                  onChange={e => setNewFolderType(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-xs text-white focus:outline-none cursor-pointer"
                >
                  <option value="movie">Movie</option>
                  <option value="show">TV Show</option>
                </select>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-white/90 shrink-0 cursor-pointer"
                >
                  Add Folder
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Tab 4: Gofile Cloud Storage & Streaming */}
        {activeTab === 'cloud' && (
          <div className="p-4 sm:p-8 space-y-6 pb-16">
            {/* Header Banner */}
            <div className="p-5 rounded-2xl liquid-glass-hero border border-blue-500/30 bg-gradient-to-br from-blue-950/40 via-black/50 to-indigo-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="p-2.5 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-400 shrink-0">
                  <Cloud className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-white">Gofile Cloud Storage & Direct Stream</h3>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-semibold flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> Auto Keep-Alive Active
                    </span>
                  </div>
                  <p className="text-xs text-white/60 mt-0.5 leading-relaxed">
                    Store unlimited movies and TV shows on Gofile for free. NovaPlex streams directly via CDN HTTP Range with 0% local disk usage, and auto-pings your media to prevent file deletion.
                  </p>
                </div>
              </div>

              <button
                onClick={handleTriggerHeartbeat}
                disabled={isPingingHeartbeat}
                className="px-4 py-2 rounded-xl liquid-glass-btn bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-400/30 text-xs font-semibold flex items-center gap-2 shrink-0 self-start sm:self-auto cursor-pointer transition-all active:scale-95"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isPingingHeartbeat ? 'animate-spin' : ''}`} />
                <span>{isPingingHeartbeat ? 'Pinging Cloud...' : 'Ping Keep-Alive Now'}</span>
              </button>
            </div>

            {/* Cloud Storage Metrics & Account Card */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-xl bg-white/[0.04] border border-white/10 flex flex-col justify-between">
                <span className="text-[11px] font-medium text-white/50">Gofile Account</span>
                <div className="mt-2">
                  <div className="text-sm font-bold text-white truncate">
                    {gofileStatus?.account?.email || 'spartanx496@gmail.com'}
                  </div>
                  <div className="text-[10px] text-blue-400 font-medium capitalize mt-0.5">
                    Tier: {gofileStatus?.account?.tier || 'Standard'} (Unlimited Storage)
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.04] border border-white/10 flex flex-col justify-between">
                <span className="text-[11px] font-medium text-white/50">Auto Keep-Alive Shield</span>
                <div className="mt-2">
                  <div className="text-sm font-bold text-emerald-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Permanent Preservation
                  </div>
                  <div className="text-[10px] text-white/60 mt-0.5">
                    {gofileStatus?.lastHeartbeat 
                      ? `Last heartbeat: ${new Date(gofileStatus.lastHeartbeat).toLocaleString()}`
                      : 'Scheduled every 24h (1 KB Range Ping)'}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.04] border border-white/10 flex flex-col justify-between">
                <span className="text-[11px] font-medium text-white/50">Cloud Media Indexed</span>
                <div className="mt-2">
                  <div className="text-sm font-bold text-white">
                    {gofileStatus?.cloudFilesCount || 0} Title(s) in Library
                  </div>
                  <div className="text-[10px] text-white/60 mt-0.5">
                    Direct Play 206 • 0 Byte Local Footprint
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Add Cloud Movie Card */}
            <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10">
              <div className="flex items-center gap-2 mb-3">
                <PlusCircle className="w-4 h-4 text-blue-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Add Movie or Show from Gofile Cloud
                </h4>
              </div>
              <p className="text-xs text-white/60 mb-4">
                Paste any Gofile video download or stream URL. NovaPlex creates a lightweight <code className="text-blue-300">.strm</code> pointer and automatically fetches metadata, posters, and cast from TMDB.
              </p>

              <form onSubmit={handleAddCloudMovie} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-white/60 mb-1">Movie / Episode Title</label>
                    <input
                      type="text"
                      placeholder="e.g. Interstellar or Avatar: The Way of Water"
                      value={cloudForm.title}
                      onChange={e => setCloudForm({ ...cloudForm, title: e.target.value })}
                      required
                      className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-white/60 mb-1">Release Year</label>
                    <input
                      type="number"
                      placeholder="2024"
                      value={cloudForm.year}
                      onChange={e => setCloudForm({ ...cloudForm, year: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-white/60 mb-1">Gofile CDN Direct Stream / Download URL</label>
                  <input
                    type="url"
                    placeholder="https://store10.gofile.io/download/web/.../movie.mp4"
                    value={cloudForm.streamUrl}
                    onChange={e => setCloudForm({ ...cloudForm, streamUrl: e.target.value })}
                    required
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-xs text-white font-mono focus:outline-none focus:border-blue-400"
                  />
                  <span className="text-[10px] text-white/40 mt-1 block">
                    Supports any Gofile direct download link or standard HTTP/HTTPS video URL.
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-white/60">Library Target:</label>
                    <select
                      value={cloudForm.libraryType}
                      onChange={e => setCloudForm({ ...cloudForm, libraryType: e.target.value })}
                      className="px-2.5 py-1 rounded-lg bg-black/40 border border-white/15 text-xs text-white focus:outline-none cursor-pointer"
                    >
                      <option value="movie">Movies Library</option>
                      <option value="show">TV Shows Library</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={isAddingCloud || !cloudForm.title.trim() || !cloudForm.streamUrl.trim()}
                    className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isAddingCloud ? 'Adding & Fetching TMDB...' : 'Add to NovaPlex & Stream'}
                  </button>
                </div>
              </form>
            </div>

            {/* Cloud Media Items List */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider text-white/70">
                Indexed Cloud Streams ({gofileStatus?.cloudFiles?.length || 0})
              </h4>

              {gofileStatus?.cloudFiles?.length === 0 ? (
                <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/10 text-center text-xs text-white/40">
                  No cloud streams added yet. Add a Gofile stream link above to watch movies with 0 local disk space.
                </div>
              ) : (
                <div className="space-y-2">
                  {gofileStatus?.cloudFiles?.map((file, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/10 flex items-center justify-between gap-3 transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400 shrink-0">
                          <Film className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">
                            {file.fileName.replace(/\.strm$/i, '')}
                          </div>
                          <div className="text-[10px] text-white/40 truncate font-mono mt-0.5">
                            {file.url}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-semibold">
                          Active CDN
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Gofile API Token Card */}
            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/10">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider text-white/70 mb-2">
                Gofile Account Token
              </h4>
              <p className="text-xs text-white/60 mb-3">
                Your authenticated Gofile token is stored securely in SQLite and used for direct stream authorization and keep-alive heartbeats.
              </p>
              <form onSubmit={handleSaveGofileToken} className="flex gap-2">
                <input
                  type="password"
                  value={gofileTokenInput}
                  onChange={e => setGofileTokenInput(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-xs text-white font-mono focus:outline-none focus:border-blue-400"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/15 transition-all cursor-pointer"
                >
                  Save Token
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Tab 5: Engine Settings */}
        {activeTab === 'config' && (
          <form onSubmit={handleSaveSettings} className="p-4 sm:p-8 space-y-5 pb-16">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider text-white/70">
              Transcoding & HDR Engine Parameters
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5">Server Display Name</label>
                <input
                  type="text"
                  value={formSettings.server_name}
                  onChange={e => setFormSettings({ ...formSettings, server_name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-xs text-white focus:outline-none focus:border-white/40"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5">Default Transcoding Profile</label>
                <select
                  value={formSettings.transcode_default_quality}
                  onChange={e => setFormSettings({ ...formSettings, transcode_default_quality: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-xs text-white focus:outline-none cursor-pointer"
                >
                  <option value="direct">Direct Play (Original 4K Passthrough)</option>
                  <option value="4k">4K Ultra HD (30 Mbps)</option>
                  <option value="1080p">1080p Full HD (10 Mbps)</option>
                  <option value="720p">720p HD (3.5 Mbps)</option>
                  <option value="480p">480p SD (1.2 Mbps)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5">HDR Tonemapping Engine</label>
                <select
                  value={formSettings.hdr_tonemap_mode}
                  onChange={e => setFormSettings({ ...formSettings, hdr_tonemap_mode: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-xs text-white focus:outline-none cursor-pointer"
                >
                  <option value="auto">Auto (Preserve HDR10+ when client compatible)</option>
                  <option value="force_sdr">Always Tonemap to SDR (Hable algorithm)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5">TMDB API Key (Optional)</label>
                <input
                  type="password"
                  placeholder="Paste key to enhance metadata & artwork"
                  value={formSettings.tmdb_api_key}
                  onChange={e => setFormSettings({ ...formSettings, tmdb_api_key: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-xs text-white focus:outline-none focus:border-white/40"
                />
              </div>
            </div>

            <div className="pt-4 flex items-center justify-between border-t border-white/10">
              {savedSuccess ? (
                <span className="text-xs text-emerald-400 flex items-center gap-1.5 font-semibold">
                  <Check className="w-4 h-4" /> Configuration saved successfully
                </span>
              ) : <span />}

              <button
                type="submit"
                className="px-6 py-2.5 rounded-full glass-pill bg-white text-black font-bold text-xs hover:bg-white/90 shadow-lg cursor-pointer"
              >
                Save Engine Configuration
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
