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
      className="flex flex-col h-full"
      style={{
        width: 260, minWidth: 260,
        borderRight: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      {/* Logo + theme toggle */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4 flex-shrink-0">
        <Link href="/browse">
          <h1 className="font-display text-2xl tracking-tight select-none" style={{ color: 'var(--text-1)' }}>
            Li<span style={{ color: 'var(--accent)' }}>To</span>
          </h1>
        </Link>
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-base transition-colors hover:opacity-70"
          style={{ background: 'var(--elevated)', color: 'var(--text-2)' }}
          title={`Switch to ${theme === 'default' ? 'mono' : 'default'} theme`}
        >
          ◐
        </button>
      </div>

      {/* Nav */}
      <nav className="px-3 space-y-0.5 flex-shrink-0">
        <Link
          href="/browse"
          className="flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium transition-colors hover:opacity-80"
          style={{ color: 'var(--text-2)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--elevated)'; e.currentTarget.style.color = 'var(--text-1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--text-2)'; }}
        >
          <HomeIcon /> Browse Rooms
        </Link>
        <CreateRoomButton />
      </nav>

      <div className="mx-4 my-4 h-px flex-shrink-0" style={{ background: 'var(--border)' }} />

      {/* Now playing */}
      <div className="flex-1 flex flex-col px-4 pb-5 min-h-0 overflow-hidden">
        <p className="text-[10px] uppercase tracking-widest font-medium flex-shrink-0 mb-3" style={{ color: 'var(--text-3)' }}>
          Now Playing
        </p>

        {currentTrack ? (
          <div className="flex flex-col gap-3 min-h-0">
            {/* Album art */}
            <div
              className="relative w-full rounded-2xl overflow-hidden flex-shrink-0"
              style={{
                aspectRatio: '1',
                background: 'var(--elevated)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
              }}
            >
              {currentTrack.thumbnailUrl ? (
                <>
                  <Thumb src={currentTrack.thumbnailUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
                  {/* Subtle adaptive glow overlay at bottom */}
                  <div
                    className="absolute inset-x-0 bottom-0 h-1/3"
                    style={{ background: 'linear-gradient(to top, var(--adapt-glow), transparent)' }}
                  />
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-4xl" style={{ color: 'var(--text-3)' }}>♪</div>
              )}

              {/* Playing indicator badge */}
              {isPlaying && (
                <div
                  className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                  style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', color: 'var(--adapt-primary)' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full live-dot" style={{ background: 'var(--adapt-primary)' }} />
                  LIVE
                </div>
              )}
            </div>

            {/* Track info */}
            <div className="min-w-0 flex-shrink-0">
              <p className="text-sm font-semibold truncate leading-tight" style={{ color: 'var(--text-1)' }}>
                {currentTrack.title}
              </p>
              <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                {currentTrack.artist}
              </p>
            </div>

            {/* Adaptive waveform */}
            <div className="flex-shrink-0">
              <Visualizer isPlaying={isPlaying} bars={28} />
            </div>

            {/* Host controls */}
            {isHostOrDj && (
              <div className="space-y-2 flex-shrink-0">
                {/* Main transport */}
                <div className="flex items-center justify-between px-1">
                  <button
                    onClick={onSkipPrev}
                    className="p-2 rounded-xl transition-colors hover:opacity-70"
                    style={{ color: 'var(--text-2)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--elevated)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                    title="Previous"
                  >
                    <SkipBackIcon />
                  </button>

                  <button
                    onClick={() => isPlaying ? onPause(currentPositionMs) : onPlay(currentPositionMs)}
                    className="w-12 h-12 rounded-full flex items-center justify-center transition-all hover:opacity-80 active:scale-95"
                    style={{
                      background: 'var(--accent)',
                      color: '#fff',
                      boxShadow: '0 4px 20px var(--accent-glow)',
                    }}
                  >
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                  </button>

                  <button
                    onClick={onSkipNext}
                    className="p-2 rounded-xl transition-colors hover:opacity-70"
                    style={{ color: 'var(--text-2)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--elevated)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                    title="Next"
                  >
                    <SkipForwardIcon />
                  </button>
                </div>

                {/* Secondary controls */}
                <div className="flex items-center justify-around px-1">
                  <ControlBtn
                    onClick={onToggleLoop}
                    active={playbackState.isLooping}
                    title="Repeat"
                  >
                    <RepeatIcon />
                  </ControlBtn>
                  <ControlBtn title="Shuffle">
                    <ShuffleIcon />
                  </ControlBtn>
                  <ControlBtn title="Queue">
                    <QueueIcon />
                  </ControlBtn>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 text-center gap-3">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--elevated)', color: 'var(--text-3)' }}
            >
              <MusicIcon />
            </div>
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Nothing playing yet</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)', opacity: 0.6 }}>Add a song to the queue</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Small helper ── */
function ControlBtn({
  children, onClick, active, title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-2 rounded-xl transition-colors hover:opacity-80"
      style={{
        color: active ? 'var(--adapt-primary)' : 'var(--text-3)',
        background: active ? 'color-mix(in srgb, var(--adapt-dim) 25%, transparent)' : 'transparent',
      }}
    >
      {children}
    </button>
  );
}

/* ── Create room inline modal ── */
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
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium transition-colors hover:opacity-80"
        style={{ color: 'var(--text-2)' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--elevated)'; e.currentTarget.style.color = 'var(--text-1)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--text-2)'; }}
      >
        <PlusIcon /> Create Room
      </button>

      {show && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShow(false); setName(''); } }}
        >
          <div className="apple-glass rounded-3xl p-6 w-full max-w-sm">
            <h2 className="font-display text-lg mb-1" style={{ color: 'var(--text-1)' }}>Create a Room</h2>
            <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>Give your room a name</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Room name…"
              maxLength={60}
              autoFocus
              className="w-full rounded-2xl px-4 py-3 text-sm outline-none mb-4 transition-colors"
              style={{ background: 'var(--elevated)', border: '1.5px solid var(--border)', color: 'var(--text-1)' }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShow(false); setName(''); }}
                className="flex-1 py-2.5 rounded-2xl text-sm transition-colors hover:opacity-80"
                style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || loading}
                className="btn-accent flex-1 py-2.5 text-sm"
              >
                {loading ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── SVG Icons ── */
function HomeIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>; }
function PlusIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>; }
function PlayIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>; }
function PauseIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>; }
function SkipBackIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>; }
function SkipForwardIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>; }
function RepeatIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>; }
function ShuffleIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>; }
function QueueIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/></svg>; }
function MusicIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>; }
