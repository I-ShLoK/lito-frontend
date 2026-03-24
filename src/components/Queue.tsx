'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Thumb from './Thumb';
import { useStore } from '@/store';
import api from '@/lib/api';

interface VideoResult {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  thumbnailUrl: string;
}

interface QueueProps {
  onAddToQueue: (item: {
    youtubeId: string;
    title: string;
    artist: string;
    durationMs: number;
    thumbnailUrl: string;
    mode: 'next' | 'end';
  }) => void;
  onRemoveFromQueue: (id: string) => void;
  onReorderQueue?: (id: string, newIndex: number) => void;
  isHostOrDj: boolean;
  showSearch?: boolean;
  onRequestSearch?: () => void;
  smartQueueItems?: VideoResult[];
  smartQueueEnabled?: boolean;
  smartQueueLoading?: boolean;
  onToggleSmartQueueEnabled?: () => void;
  showSmartQueueSection?: boolean;
  onClearQueue?: () => void;
  canClearQueue?: boolean;
}

function formatDuration(ms: number): string {
  if (!ms || Number.isNaN(ms) || ms <= 0) return '--:--';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function Queue({
  onAddToQueue, onRemoveFromQueue, onReorderQueue,
  isHostOrDj, showSearch = true, onRequestSearch,
  smartQueueItems = [], smartQueueEnabled = true, smartQueueLoading = false,
  onToggleSmartQueueEnabled, showSmartQueueSection = true,
  onClearQueue, canClearQueue = false,
}: QueueProps) {
  const queue = useStore((s) => s.queue);
  const currentTrack = useStore((s) => s.currentTrack);
  const userId = useStore((s) => s.userId);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VideoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [menuTargetId, setMenuTargetId] = useState<string | null>(null);
  const [queueScrollTop, setQueueScrollTop] = useState(0);
  const queueListRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const doSearch = async (q: string) => {
    if (!q.trim()) { setResults([]); setShowResults(false); return; }
    setSearching(true);
    try {
      const res = await api.get(`/api/music/search?q=${encodeURIComponent(q)}`);
      setResults(res.data);
      setShowResults(true);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowResults(false); setMenuTargetId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const triggerHaptic = () => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(12);
  };

  const handleAdd = (result: VideoResult, mode: 'next' | 'end') => {
    triggerHaptic();
    onAddToQueue({ youtubeId: result.id, title: result.title, artist: result.artist, durationMs: result.durationMs, thumbnailUrl: result.thumbnailUrl, mode });
    setQuery(''); setShowResults(false); setResults([]);
  };

  const handleDrop = (targetId: string) => {
    if (!draggingId || !onReorderQueue || draggingId === targetId) return;
    const nextIndex = queue.findIndex((x) => x.id === targetId);
    if (nextIndex >= 0) onReorderQueue(draggingId, nextIndex);
    setDraggingId(null);
  };

  const handleMenuAction = (action: 'next' | 'top' | 'remove') => {
    if (!menuTargetId) return;
    const idx = queue.findIndex((q) => q.id === menuTargetId);
    if (idx < 0) return;
    if (action === 'remove') onRemoveFromQueue(menuTargetId);
    if (onReorderQueue && action === 'next') onReorderQueue(menuTargetId, currentTrack ? 1 : 0);
    if (onReorderQueue && action === 'top') onReorderQueue(menuTargetId, 0);
    triggerHaptic();
    setMenuTargetId(null);
  };

  const smartTags = (r: VideoResult) => {
    const text = `${r.title} ${r.artist}`.toLowerCase();
    const out: string[] = [];
    if (/telugu|hindi|tamil|punjabi|malayalam|english/.test(text)) out.push('language match');
    if (/official|audio|lyric|lyrics|album/.test(text)) out.push('room taste');
    if (/feat|ft|mix|version/.test(text)) out.push('same artist');
    if (out.length === 0) out.push('room taste');
    return out.slice(0, 2);
  };

  return (
    <div className="relative flex flex-col h-full">

      {/* Search */}
      {showSearch && (
        <div className="p-3 relative" ref={wrapperRef}>
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value.trim()) { setResults([]); setShowResults(false); }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') doSearch(query); }}
              placeholder="Search for a song… (Enter)"
              className="w-full rounded-2xl px-4 py-2.5 text-sm outline-none transition-colors"
              style={{ background: 'var(--elevated)', border: '1.5px solid var(--border)', color: 'var(--text-1)' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; if (results.length > 0) setShowResults(true); }}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
            {searching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
              </div>
            )}
          </div>

          <AnimatePresence>
            {showResults && results.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute left-3 right-3 top-full mt-1 z-50 overflow-hidden shadow-2xl rounded-2xl"
                style={{ maxHeight: 360, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                {results.map((r, i) => (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="flex items-center gap-3 p-2 group cursor-pointer transition-colors"
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--elevated)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0" style={{ background: 'var(--elevated)' }}>
                      <Thumb src={r.thumbnailUrl || `https://i.ytimg.com/vi/${r.id}/hqdefault.jpg`} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>{r.title}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{r.artist} · {formatDuration(r.durationMs)}</p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleAdd(r, 'next')}
                        className="text-xs px-2 py-1 rounded-lg font-medium transition-opacity hover:opacity-80"
                        style={{ background: 'var(--accent)', color: '#fff' }}
                      >
                        Next
                      </button>
                      <button
                        onClick={() => handleAdd(r, 'end')}
                        className="text-xs px-2 py-1 rounded-lg transition-colors hover:opacity-80"
                        style={{ background: 'var(--elevated)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                      >
                        End
                      </button>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}

            {showResults && results.length === 0 && !searching && query.trim() && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute left-3 right-3 top-full mt-1 rounded-2xl p-4 text-center text-sm z-50"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
              >
                No results found
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Queue list */}
      <div
        ref={queueListRef}
        className="flex-1 overflow-y-auto px-2 pb-2"
        onScroll={(e) => setQueueScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        {canClearQueue && onClearQueue && (
          <div
            className="sticky top-0 z-10 px-1 py-2 mb-1 flex items-center justify-between"
            style={{ background: 'color-mix(in srgb, var(--bg) 85%, transparent)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}
          >
            <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Up Next</p>
            <button
              onClick={() => { triggerHaptic(); onClearQueue(); }}
              className="text-xs px-2 py-1 rounded-lg transition-opacity hover:opacity-80"
              style={{ background: 'rgba(232,33,58,0.15)', color: '#f87171', border: '1px solid rgba(232,33,58,0.3)' }}
            >
              Clear Queue
            </button>
          </div>
        )}

        <AnimatePresence>
          {queue.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-sm py-8 px-4 space-y-3" style={{ color: 'var(--text-3)' }}>
              <p>No queue yet.</p>
              {showSearch ? (
                <div className="flex justify-center flex-wrap gap-2">
                  {['latest telugu songs', 'hindi hits', 'english pop', 'tamil playlist'].map((chip) => (
                    <button
                      key={chip}
                      onClick={() => { setQuery(chip); doSearch(chip); }}
                      className="text-xs px-3 py-1.5 rounded-full transition-opacity hover:opacity-80"
                      style={{ background: 'var(--elevated)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              ) : onRequestSearch && (
                <button
                  onClick={onRequestSearch}
                  className="text-xs px-3 py-1.5 rounded-full transition-opacity hover:opacity-80"
                  style={{ background: 'var(--elevated)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                >
                  Open search to add songs
                </button>
              )}
            </motion.div>
          ) : (
            (() => {
              const rowH = 70;
              const viewport = 520;
              const overscan = 4;
              const startIndex = Math.max(0, Math.floor(queueScrollTop / rowH) - overscan);
              const endIndex = Math.min(queue.length, Math.ceil((queueScrollTop + viewport) / rowH) + overscan);
              const visibleQueue = queue.slice(startIndex, endIndex);
              const topPad = startIndex * rowH;
              const bottomPad = Math.max(0, (queue.length - endIndex) * rowH);

              return (
                <>
                  <div style={{ height: topPad }} />
                  {visibleQueue.map((item, offset) => {
                    const i = startIndex + offset;
                    const isCurrent = currentTrack?.youtubeId === item.youtubeId && i === 0;
                    const canRemove = isHostOrDj || item.addedBy === userId;

                    return (
                      <motion.div
                        key={item.id}
                        draggable={isHostOrDj}
                        onDragStart={() => setDraggingId(item.id)}
                        onDragOver={(e) => { if (!isHostOrDj || !onReorderQueue) return; e.preventDefault(); }}
                        onDrop={() => handleDrop(item.id)}
                        onDragEnd={() => setDraggingId(null)}
                        onContextMenu={(e) => { if (!isHostOrDj) return; e.preventDefault(); setMenuTargetId(item.id); }}
                        onTouchStart={() => {
                          if (!isHostOrDj) return;
                          if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                          longPressTimerRef.current = setTimeout(() => { setMenuTargetId(item.id); triggerHaptic(); }, 480);
                        }}
                        onTouchEnd={() => { if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; } }}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ delay: i * 0.03 }}
                        className={`flex items-center gap-2 p-2.5 rounded-2xl group transition-colors ${draggingId === item.id ? 'opacity-50' : ''}`}
                        style={isCurrent ? {
                          background: 'color-mix(in srgb, var(--adapt-dim) 20%, var(--elevated))',
                          border: '1px solid color-mix(in srgb, var(--adapt-dim) 40%, var(--border))',
                        } : {}}
                        onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'var(--elevated)'; }}
                        onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = ''; }}
                      >
                        <span className="text-xs w-7 text-center flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                          {isCurrent
                            ? <span style={{ color: 'var(--adapt-primary)' }} className="flex items-center justify-center gap-1">
                                <span className="inline-block w-1.5 h-1.5 rounded-full live-dot" style={{ background: 'var(--adapt-primary)' }} />
                              </span>
                            : i + 1}
                        </span>

                        {isHostOrDj && onReorderQueue && (
                          <span className="text-xs select-none cursor-grab active:cursor-grabbing opacity-50" style={{ color: 'var(--text-3)' }}>⋮⋮</span>
                        )}

                        <motion.div layoutId={`track-art-${item.youtubeId}`} className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0" style={{ background: 'var(--elevated)' }}>
                          <Thumb src={item.thumbnailUrl || `https://i.ytimg.com/vi/${item.youtubeId}/hqdefault.jpg`} alt="" className="w-full h-full object-cover" />
                        </motion.div>

                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate" style={{ color: isCurrent ? 'var(--adapt-primary)' : 'var(--text-1)' }}>{item.title}</p>
                          <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                            {item.artist}{item.addedByUsername ? ` · ${item.addedByUsername}` : ''}
                          </p>
                        </div>

                        <span className="text-[11px] flex-shrink-0 font-mono" style={{ color: 'var(--text-3)' }}>{formatDuration(Number(item.durationMs || 0))}</span>

                        {canRemove && (
                          <button
                            onClick={() => { triggerHaptic(); onRemoveFromQueue(item.id); }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-sm w-6 h-6 flex items-center justify-center rounded-lg hover:opacity-80"
                            style={{ color: 'var(--text-3)' }}
                          >
                            ×
                          </button>
                        )}
                      </motion.div>
                    );
                  })}
                  <div style={{ height: bottomPad }} />
                </>
              );
            })()
          )}
        </AnimatePresence>

        {/* Smart Queue */}
        {showSmartQueueSection && (
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between px-1 mb-2">
              <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Smart Queue</p>
              <button
                onClick={() => { triggerHaptic(); onToggleSmartQueueEnabled?.(); }}
                className="text-xs px-2 py-1 rounded-lg font-medium transition-opacity hover:opacity-80"
                style={smartQueueEnabled
                  ? { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' }
                  : { background: 'var(--elevated)', color: 'var(--text-2)', border: '1px solid var(--border)' }
                }
              >
                {smartQueueEnabled ? 'Auto-play ON' : 'Auto-play OFF'}
              </button>
            </div>

            {smartQueueLoading ? (
              <div className="space-y-2 px-1">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-12 rounded-2xl" />)}
              </div>
            ) : smartQueueItems.length === 0 ? (
              <p className="px-1 pb-2 text-xs" style={{ color: 'var(--text-3)' }}>No suggestions yet. Play a song to generate them.</p>
            ) : (
              <div className="space-y-1">
                {smartQueueItems.slice(0, 6).map((r) => (
                  <div
                    key={`smart-${r.id}`}
                    className="flex items-center gap-2 p-2 rounded-2xl group transition-colors"
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--elevated)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0" style={{ background: 'var(--elevated)' }}>
                      <Thumb src={r.thumbnailUrl || `https://i.ytimg.com/vi/${r.id}/hqdefault.jpg`} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs truncate" style={{ color: 'var(--text-1)' }}>{r.title}</p>
                      <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>{r.artist}</p>
                      <div className="flex gap-1 mt-1">
                        {smartTags(r).map((tag) => (
                          <span key={`${r.id}-${tag}`} className="pill" style={{ fontSize: 9, padding: '1px 6px' }}>{tag}</span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => handleAdd(r, 'end')}
                      className="text-xs px-2 py-1.5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity hover:opacity-80"
                      style={{ background: 'var(--accent)', color: '#fff' }}
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Context menu */}
      <AnimatePresence>
        {menuTargetId && isHostOrDj && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute left-3 right-3 bottom-3 z-40 flex items-center gap-2 p-2 rounded-2xl shadow-2xl"
            style={{ background: 'color-mix(in srgb, var(--surface) 95%, transparent)', border: '1px solid var(--border)', backdropFilter: 'blur(20px)' }}
          >
            <button onClick={() => handleMenuAction('next')} className="flex-1 text-xs px-2 py-2 rounded-xl transition-opacity hover:opacity-80" style={{ background: 'var(--elevated)', color: 'var(--text-2)' }}>Play next</button>
            <button onClick={() => handleMenuAction('top')} className="flex-1 text-xs px-2 py-2 rounded-xl transition-opacity hover:opacity-80" style={{ background: 'var(--elevated)', color: 'var(--text-2)' }}>Move top</button>
            <button onClick={() => handleMenuAction('remove')} className="flex-1 text-xs px-2 py-2 rounded-xl transition-opacity hover:opacity-80" style={{ background: 'rgba(232,33,58,0.15)', color: '#f87171' }}>Remove</button>
            <button onClick={() => setMenuTargetId(null)} className="text-xs px-2 py-2 rounded-xl transition-opacity hover:opacity-80" style={{ color: 'var(--text-3)' }}>✕</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
