'use client';
// Trigger build break
const crashTest: string = 12345;
undefinedFunctionCall();
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
      if (status === 409) toast.error('Name taken — try another');
      else toast.error(msg || 'Failed to join');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-4 py-10">

      {/* Ambient blobs */}
      <div className="mesh-bg" aria-hidden>
        <div
          className="mesh-blob"
          style={{
            width: '28rem', height: '28rem',
            top: '-6rem', left: '-8rem',
            background: 'var(--accent)',
          }}
        />
        <div
          className="mesh-blob"
          style={{
            width: '22rem', height: '22rem',
            bottom: '-4rem', right: '-6rem',
            background: 'var(--accent-dim)',
            animationDelay: '-9s',
          }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-sm"
      >
        {/* Card */}
        <div className="apple-glass rounded-3xl p-8">

          {/* Header row */}
          <div className="flex items-start justify-between mb-10">
            <div>
              <h1 className="font-display text-6xl leading-none tracking-tight">
                Li<span style={{ color: 'var(--accent)' }}>To</span>
              </h1>
              <p className="text-sm mt-2" style={{ color: 'var(--text-3)' }}>
                Mobile-first shared listening rooms
              </p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <InstallAppButton compact />
              <button
                onClick={toggleTheme}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-base transition-colors hover:opacity-80"
                style={{ background: 'var(--elevated)', color: 'var(--text-2)' }}
                title="Toggle theme"
              >
                ◐
              </button>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                maxLength={20}
                autoFocus
                autoComplete="username"
                className="w-full rounded-2xl px-4 py-3.5 text-sm outline-none transition-all"
                style={{
                  background: 'var(--elevated)',
                  border: `1.5px solid ${isValid && username ? 'var(--accent)' : 'var(--border)'}`,
                  color: 'var(--text-1)',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = isValid && username ? 'var(--accent)' : 'var(--border)')}
              />
              <p className="text-xs px-1" style={{ color: 'var(--text-3)' }}>
                3–20 chars · letters, numbers, underscore
              </p>
            </div>

            <button
              type="submit"
              disabled={!isValid || loading}
              className="btn-accent w-full py-3.5 text-sm font-semibold"
            >
              {loading ? 'Joining…' : 'Enter Room Network'}
            </button>
          </form>

          {/* Decorative tracks strip */}
          <div className="flex gap-1.5 mt-8 overflow-hidden opacity-30">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="flex-shrink-0 h-1 rounded-full"
                style={{
                  width: `${16 + Math.random() * 32}px`,
                  background: 'var(--accent)',
                  opacity: 0.4 + Math.random() * 0.6,
                }}
              />
            ))}
          </div>
        </div>

        {/* Bottom hint */}
        <p className="text-center text-xs mt-5" style={{ color: 'var(--text-3)' }}>
          No account needed · just pick a name and jump in
        </p>
      </motion.div>
    </div>
  );
}
