'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useStore } from '@/store';
import api from '@/lib/api';
import RoomCard, { RoomCardSkeleton } from '@/components/RoomCard';
import InstallAppButton from '@/components/InstallAppButton';

interface Room {
  id: string;
  slug: string;
  name: string;
  participantCount: number;
  thumbnailUrl?: string;
  trackTitle?: string;
  trackArtist?: string;
  hostUsername?: string;
}

export default function BrowsePage() {
  const router = useRouter();
  const { token, username, toggleTheme, clearAuth } = useStore();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!token) { router.replace('/'); return; }
  }, [token, router]);

  const fetchRooms = useCallback(async () => {
    try {
      const res = await api.get('/api/rooms');
      setRooms(res.data.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        slug: String(r.slug),
        name: String(r.name),
        participantCount: Number(r.participant_count || 0),
        thumbnailUrl: r.thumbnail_url as string,
        trackTitle: r.track_title as string,
        trackArtist: r.track_artist as string,
        hostUsername: r.host_username as string,
      })));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    const interval = setInterval(fetchRooms, 10_000);
    return () => clearInterval(interval);
  }, [fetchRooms]);

  const handleCreate = async () => {
    if (!roomName.trim()) return;
    setCreating(true);
    try {
      const res = await api.post('/api/rooms', { name: roomName.trim(), isPublic: true });
      router.push(`/room/${res.data.slug}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create room';
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleLogout = async () => {
    try { await api.post('/api/auth/leave'); } catch { /* ignore */ }
    clearAuth();
    router.replace('/');
  };

  const [featured, ...rest] = rooms;

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* Ambient blobs */}
      <div className="mesh-bg" aria-hidden>
        <div className="mesh-blob" style={{ width: '30rem', height: '30rem', top: '-8rem', left: '-10rem', background: 'var(--accent)' }} />
        <div className="mesh-blob" style={{ width: '24rem', height: '24rem', bottom: '10%', right: '-8rem', background: 'var(--accent-dim)', animationDelay: '-10s' }} />
      </div>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 border-b"
        style={{ background: 'color-mix(in srgb, var(--bg) 85%, transparent)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}
      >
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="font-display text-xl tracking-tight" style={{ color: 'var(--text-1)' }}>
            Li<span style={{ color: 'var(--accent)' }}>To</span>
          </h1>

          <div className="flex items-center gap-2">
            {/* Username pill */}
            <span
              className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
              style={{ background: 'var(--elevated)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full live-dot"
                style={{ background: 'var(--accent)' }}
              />
              {username}
            </span>

            <InstallAppButton compact />

            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-base transition-opacity hover:opacity-70"
              style={{ background: 'var(--elevated)', color: 'var(--text-2)' }}
            >
              ◐
            </button>

            <button
              onClick={() => setShowCreate(true)}
              className="btn-accent px-4 py-1.5 text-sm"
            >
              + Create
            </button>

            <button
              onClick={handleLogout}
              className="text-sm transition-colors hover:opacity-80"
              style={{ color: 'var(--text-3)' }}
            >
              Leave
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-4 py-8 relative z-10">

        {/* Featured / Most Active */}
        {!loading && featured && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-10"
          >
            <SectionLabel>🔥 Most Active</SectionLabel>
            <RoomCard {...featured} featured />
          </motion.section>
        )}

        {loading && (
          <div className="mb-10">
            <SectionLabel>🔥 Most Active</SectionLabel>
            <RoomCardSkeleton featured />
          </div>
        )}

        {/* All rooms grid */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <SectionLabel>All Rooms</SectionLabel>
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              {!loading && `${rooms.length} live`}
            </span>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => <RoomCardSkeleton key={i} />)}
            </div>
          ) : rest.length === 0 && !featured ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-24 gap-3"
              style={{ color: 'var(--text-3)' }}
            >
              <span className="text-5xl">🎵</span>
              <p className="text-lg font-display">No rooms yet</p>
              <p className="text-sm">Create one and invite your friends.</p>
              <button onClick={() => setShowCreate(true)} className="btn-accent px-5 py-2 text-sm mt-2">
                Create a Room
              </button>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {rest.map((room, i) => (
                <motion.div
                  key={room.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <RoomCard {...room} />
                </motion.div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ── Create modal ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
            onClick={(e) => { if (e.target === e.currentTarget) { setShowCreate(false); setRoomName(''); } }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              className="apple-glass rounded-3xl p-6 w-full max-w-sm"
            >
              <h2 className="font-display text-xl mb-1" style={{ color: 'var(--text-1)' }}>Create a Room</h2>
              <p className="text-xs mb-5" style={{ color: 'var(--text-3)' }}>Give your listening room a name</p>

              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Room name…"
                maxLength={60}
                autoFocus
                className="w-full rounded-2xl px-4 py-3 text-sm outline-none mb-4 transition-colors"
                style={{
                  background: 'var(--elevated)',
                  border: '1.5px solid var(--border)',
                  color: 'var(--text-1)',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              />

              <div className="flex gap-2">
                <button
                  onClick={() => { setShowCreate(false); setRoomName(''); }}
                  className="flex-1 py-2.5 rounded-2xl text-sm transition-colors hover:opacity-80"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!roomName.trim() || creating}
                  className="btn-accent flex-1 py-2.5 text-sm"
                >
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs uppercase tracking-widest font-medium mb-3" style={{ color: 'var(--text-3)' }}>
      {children}
    </p>
  );
}
