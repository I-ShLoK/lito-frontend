'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
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
    const interval = setInterval(fetchRooms, 10000);
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
    try {
      await api.post('/api/auth/leave');
    } catch {
      // ignore
    }
    clearAuth();
    router.replace('/');
  };

  return (
    <div className="min-h-screen bg-bg relative overflow-hidden">
      <div className="mesh-bg" aria-hidden>
        <div className="mesh-blob w-[28rem] h-[28rem] -top-24 -left-28" style={{ background: 'var(--accent)' }} />
        <div className="mesh-blob w-[26rem] h-[26rem] top-1/2 -right-24" style={{ background: 'var(--accent-dim)' }} />
      </div>

      <header className="border-b border-[var(--border)] bg-surface/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="font-display text-xl font-700 text-t1">Li<span className="text-accent">To</span></h1>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="text-sm text-t2 hidden sm:block">{username}</span>
            <InstallAppButton compact />
            <button onClick={toggleTheme} className="text-t2 hover:text-t1 transition-colors">?</button>
            <button onClick={() => setShowCreate(true)} className="px-4 py-1.5 bg-accent text-bg rounded-full text-sm font-medium hover:opacity-80 transition-opacity">
              + Create
            </button>
            <button onClick={handleLogout} className="text-sm text-t3 hover:text-t1 transition-colors">Leave</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 relative z-[1]">
        {!loading && rooms.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <p className="text-xs text-t3 uppercase tracking-widest mb-3">Most Active</p>
            <RoomCard {...rooms[0]} />
          </motion.div>
        )}

        <div>
          <p className="text-xs text-t3 uppercase tracking-widest mb-3">All Rooms</p>
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => <RoomCardSkeleton key={i} compact />)}
            </div>
          ) : rooms.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20 text-t3">
              <p className="text-4xl mb-3">Music rooms are empty</p>
              <p>Create one and invite your friends.</p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {rooms.slice(1).map((room, i) => (
                <motion.div key={room.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <RoomCard {...room} compact />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </main>

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="bg-surface border border-[var(--border)] rounded-[var(--radius)] p-5 w-full max-w-sm">
            <h2 className="font-display text-lg mb-4">Create a Room</h2>
            <input
              type="text"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Room name..."
              maxLength={60}
              autoFocus
              className="w-full bg-elevated border border-[var(--border)] rounded-[var(--radius)] px-4 py-2.5 text-sm text-t1 placeholder:text-t3 outline-none focus:border-accent mb-4 transition-colors"
            />
            <div className="flex gap-2">
              <button onClick={() => { setShowCreate(false); setRoomName(''); }} className="flex-1 py-2 rounded-[var(--radius)] border border-[var(--border)] text-t2 hover:text-t1 text-sm transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={!roomName.trim() || creating} className="flex-1 py-2 rounded-[var(--radius)] bg-accent text-bg text-sm font-medium disabled:opacity-40 hover:opacity-80 transition-opacity">
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}