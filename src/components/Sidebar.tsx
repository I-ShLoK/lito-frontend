'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Thumb from './Thumb';
import { useStore } from '@/store';
import Visualizer from './Visualizer';

interface SidebarProps {
  onPlay: (ms: number) => void;
  onPause: (ms: number) => void;
  onSkipNext: () => void;
  onSkipPrev: () => void;
  onToggleLoop: () => void;
  currentPositionMs: number;
  isHostOrDj: boolean;
}

export default function Sidebar({
  onPlay, onPause, onSkipNext, onSkipPrev, onToggleLoop,
  currentPositionMs, isHostOrDj,
}: SidebarProps) {
  const { currentTrack, playbackState, theme, toggleTheme } = useStore();
  const isPlaying = playbackState.isPlaying;

  return (
    <div
      className="flex flex-col h-full border-r border-[var(--border)] bg-surface"
      style={{ width: 260, minWidth: 260 }}
    >
      {/* Logo + theme toggle */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4 flex-shrink-0">
        <Link href="/browse">
          <h1 className="font-display text-2xl font-700 text-t1 tracking-tight select-none">
            Li<span className="text-accent">To</span>
          </h1>
        </Link>
        <button
          onClick={toggleTheme}
          className="text-t2 hover:text-t1 transition-colors text-lg w-8 h-8 flex items-center justify-center rounded-lg hover:bg-elevated"
          title={`Switch to ${theme === 'default' ? 'mono' : 'default'} theme`}
        >
          ◐
        </button>
      </div>

      {/* Nav */}
      <nav className="px-3 space-y-0.5 flex-shrink-0">
        <Link
          href="/browse"
          className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius)] text-t2 hover:text-t1 hover:bg-elevated transition-colors text-sm font-medium"
        >
          <HomeIcon /> Browse Rooms
        </Link>
        <CreateRoomButton />
      </nav>

      <div className="mx-4 my-4 h-px bg-[var(--border)] flex-shrink-0" />

      {/* Now playing — grows to fill remaining space */}
      <div className="flex-1 flex flex-col px-4 pb-5 min-h-0 overflow-hidden">
        <p className="text-[10px] text-t3 uppercase tracking-widest mb-3 font-medium flex-shrink-0">Now Playing</p>

        {currentTrack ? (
          <div className="flex flex-col gap-3 min-h-0">
            {/* Album art — static square */}
            <div className="relative w-full rounded-xl overflow-hidden bg-elevated shadow-lg flex-shrink-0" style={{ aspectRatio: '1' }}>
              {currentTrack.thumbnailUrl
                ? <Thumb src={currentTrack.thumbnailUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-4xl text-t3">♪</div>
              }
            </div>

            {/* Track info */}
            <div className="min-w-0 flex-shrink-0">
              <p className="text-sm font-semibold text-t1 truncate leading-tight">{currentTrack.title}</p>
              <p className="text-xs text-t3 truncate mt-0.5">{currentTrack.artist}</p>
            </div>

            {/* Waveform */}
            <div className="flex-shrink-0">
              <Visualizer isPlaying={isPlaying} bars={24} />
            </div>

            {/* Controls */}
            {isHostOrDj && (
              <div className="space-y-1 flex-shrink-0">
                {/* Main transport row */}
                <div className="flex items-center justify-between px-1">
                  <button onClick={onSkipPrev} className="p-2 rounded-lg text-t2 hover:text-t1 hover:bg-elevated transition-colors" title="Previous">
                    <SkipBackIcon />
                  </button>
                  <button
                    onClick={() => isPlaying ? onPause(currentPositionMs) : onPlay(currentPositionMs)}
                    className="w-11 h-11 rounded-full bg-accent text-bg flex items-center justify-center hover:opacity-80 transition-opacity shadow-lg"
                  >
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <button onClick={onSkipNext} className="p-2 rounded-lg text-t2 hover:text-t1 hover:bg-elevated transition-colors" title="Next">
                    <SkipForwardIcon />
                  </button>
                </div>

                {/* Secondary controls */}
                <div className="flex items-center justify-around px-1 pt-1">
                  <button
                    onClick={onToggleLoop}
                    className={`p-2 rounded-lg transition-colors ${playbackState.isLooping ? 'text-accent' : 'text-t3 hover:text-t2 hover:bg-elevated'}`}
                    title="Repeat"
                  >
                    <RepeatIcon />
                  </button>
                  <button className="p-2 rounded-lg text-t3 hover:text-t2 hover:bg-elevated transition-colors" title="Shuffle">
                    <ShuffleIcon />
                  </button>
                  <button className="p-2 rounded-lg text-t3 hover:text-t2 hover:bg-elevated transition-colors" title="Queue">
                    <QueueIcon />
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 text-center">
            <div className="w-14 h-14 rounded-2xl bg-elevated flex items-center justify-center mb-3 text-t3">
              <MusicIcon />
            </div>
            <p className="text-xs text-t3">Nothing playing yet</p>
            <p className="text-xs text-t3 mt-1">Add a song to the queue</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateRoomButton() {
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const { token } = useStore();

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const api = (await import('@/lib/api')).default;
      const res = await api.post('/api/rooms', { name: name.trim(), isPublic: true });
      setShow(false);
      setName('');
      window.location.href = `/room/${res.data.slug}`;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create room';
      const toast = (await import('react-hot-toast')).default;
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!token) return null;

  return (
    <>
      <button
        onClick={() => setShow(true)}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius)] text-t2 hover:text-t1 hover:bg-elevated transition-colors text-sm font-medium"
      >
        <PlusIcon /> Create Room
      </button>
      {show && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-[var(--border)] rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="font-display text-lg font-600 mb-1">Create a Room</h2>
            <p className="text-xs text-t3 mb-4">Give your room a name</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Room name..."
              maxLength={60}
              autoFocus
              className="w-full bg-elevated border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-t1 placeholder:text-t3 outline-none focus:border-accent mb-4 transition-colors"
            />
            <div className="flex gap-2">
              <button onClick={() => { setShow(false); setName(''); }} className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-t2 hover:text-t1 text-sm transition-colors">
                Cancel
              </button>
              <button onClick={handleCreate} disabled={!name.trim() || loading} className="flex-1 py-2.5 rounded-xl bg-accent text-bg text-sm font-semibold disabled:opacity-40 hover:opacity-80 transition-opacity">
                {loading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── SVG Icons ──────────────────────────────────────────────────────────────────
function HomeIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>; }
function PlusIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>; }
function PlayIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>; }
function PauseIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>; }
function SkipBackIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>; }
function SkipForwardIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>; }
function RepeatIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>; }
function ShuffleIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>; }
function QueueIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/></svg>; }
function MusicIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>; }
