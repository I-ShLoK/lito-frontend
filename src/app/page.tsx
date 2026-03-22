'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useStore } from '@/store';
import api from '@/lib/api';
import InstallAppButton from '@/components/InstallAppButton';

export default function EntryPage() {
  const router = useRouter();
  const { token, setAuth, toggleTheme } = useStore();
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (token) router.replace('/browse');
  }, [token, router]);

  const isValid = /^[a-zA-Z0-9_]{3,20}$/.test(username);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || loading) return;

    setLoading(true);
    try {
      const res = await api.post('/api/auth/join', { username });
      setAuth(res.data.token, res.data.userId, res.data.username);
      router.push('/browse');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number; data?: { error?: string } } })?.response?.status;
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (status === 409) toast.error('Name taken - try another');
      else toast.error(msg || 'Failed to join');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="mesh-bg">
        <div className="mesh-blob w-[26rem] h-[26rem] -top-16 -left-16" style={{ background: 'var(--accent)' }} />
        <div className="mesh-blob w-[30rem] h-[30rem] top-1/3 -right-24" style={{ background: 'var(--accent-dim)' }} />
      </div>

      <div className="relative z-[1] min-h-screen grid place-items-center px-4 py-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-3xl w-full max-w-md p-6 md:p-8 border border-[var(--border)]">
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="font-display text-5xl leading-none">Li<span className="text-accent">To</span></h1>
              <p className="text-sm text-t2 mt-2">Mobile-first shared listening rooms</p>
            </div>
            <div className="flex items-center gap-2">
              <InstallAppButton compact />
              <button onClick={toggleTheme} className="w-9 h-9 rounded-xl bg-elevated text-t2">◐</button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                maxLength={20}
                autoFocus
                autoComplete="username"
                className="w-full bg-elevated border border-[var(--border)] focus:border-accent rounded-xl px-4 py-3 text-t1 placeholder:text-t3 outline-none"
              />
              <p className="text-xs text-t3 mt-2">3-20 chars, letters/numbers/underscore.</p>
            </div>

            <button
              type="submit"
              disabled={!isValid || loading}
              className="w-full py-3 rounded-xl bg-accent text-bg font-semibold disabled:opacity-40"
            >
              {loading ? 'Joining...' : 'Enter Room Network'}
            </button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}