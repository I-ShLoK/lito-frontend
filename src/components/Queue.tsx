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
}

function formatDuration(ms: number): string {
  if (!ms || Number.isNaN(ms) || ms <= 0) return '--:--';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function Queue({ onAddToQueue, onRemoveFromQueue, onReorderQueue, isHostOrDj, showSearch = true, onRequestSearch }: QueueProps) {
  const { queue, currentTrack, userId } = useStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VideoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [menuTargetId, setMenuTargetId] = useState<string | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const doSearch = async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }
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
        setShowResults(false);
        setMenuTargetId(null);
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
    onAddToQueue({
      youtubeId: result.id,
      title: result.title,
      artist: result.artist,
      durationMs: result.durationMs,
      thumbnailUrl: result.thumbnailUrl,
      mode,
    });
    setQuery('');
    setShowResults(false);
    setResults([]);
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

  return (
    <div className="relative flex flex-col h-full">
      {showSearch && (
        <div className="p-3 relative" ref={wrapperRef}>
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value.trim()) {
                  setResults([]);
                  setShowResults(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSearch(query);
              }}
              onFocus={() => results.length > 0 && setShowResults(true)}
              placeholder="Search for a song... (press Enter)"
              className="w-full bg-elevated border border-[var(--border)] rounded-[var(--radius)] px-4 py-2.5 text-sm text-t1 placeholder:text-t3 outline-none focus:border-accent transition-colors"
            />
            {searching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
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
                className="absolute left-3 right-3 top-full mt-1 bg-surface border border-[var(--border)] rounded-[var(--radius)] overflow-hidden z-50 shadow-2xl"
                style={{ maxHeight: 360, overflowY: 'auto' }}
              >
                {results.map((r, i) => (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="flex items-center gap-3 p-2 hover:bg-elevated group cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-elevated">
                      <Thumb src={r.thumbnailUrl || `https://i.ytimg.com/vi/${r.id}/hqdefault.jpg`} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-t1 truncate">{r.title}</p>
                      <p className="text-xs text-t3 truncate">
                        {r.artist} - {formatDuration(r.durationMs)}
                      </p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleAdd(r, 'next')}
                        className="text-xs px-2 py-1 bg-accent text-bg rounded-lg font-medium hover:opacity-80"
                        title="Play next"
                      >
                        Next
                      </button>
                      <button
                        onClick={() => handleAdd(r, 'end')}
                        className="text-xs px-2 py-1 bg-elevated border border-[var(--border)] text-t2 rounded-lg hover:text-t1"
                        title="Add to end"
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
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute left-3 right-3 top-full mt-1 bg-surface border border-[var(--border)] rounded-[var(--radius)] p-4 text-center text-t3 text-sm z-50"
              >
                No results found for that query
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <AnimatePresence>
          {queue.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-t3 text-sm py-8 px-4 space-y-3">
              <p>{showSearch ? 'No queue yet.' : 'No queue yet.'}</p>
              {showSearch ? (
                <div className="flex justify-center flex-wrap gap-2">
                  {['latest telugu songs', 'hindi hits', 'english pop', 'tamil playlist'].map((chip) => (
                    <button
                      key={chip}
                      onClick={() => {
                        setQuery(chip);
                        doSearch(chip);
                      }}
                      className="text-xs px-3 py-1.5 rounded-full bg-elevated border border-[var(--border)] text-t2 hover:text-t1"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              ) : (
                onRequestSearch && (
                  <button
                    onClick={onRequestSearch}
                    className="text-xs px-3 py-1.5 rounded-full bg-elevated border border-[var(--border)] text-t2 hover:text-t1"
                  >
                    Open search to add songs
                  </button>
                )
              )}
            </motion.div>
          ) : (
            queue.map((item, i) => {
              const isCurrent = currentTrack?.youtubeId === item.youtubeId && i === 0;
              const canRemove = isHostOrDj || item.addedBy === userId;
              return (
                <motion.div
                  key={item.id}
                  draggable={isHostOrDj}
                  onDragStart={() => setDraggingId(item.id)}
                  onDragOver={(e) => {
                    if (!isHostOrDj || !onReorderQueue) return;
                    e.preventDefault();
                  }}
                  onDrop={() => handleDrop(item.id)}
                  onDragEnd={() => setDraggingId(null)}
                  onContextMenu={(e) => {
                    if (!isHostOrDj) return;
                    e.preventDefault();
                    setMenuTargetId(item.id);
                  }}
                  onTouchStart={() => {
                    if (!isHostOrDj) return;
                    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = setTimeout(() => {
                      setMenuTargetId(item.id);
                      triggerHaptic();
                    }, 480);
                  }}
                  onTouchEnd={() => {
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ delay: i * 0.04 }}
                  className={`flex items-center gap-2 p-2 rounded-[var(--radius)] group hover:bg-elevated transition-colors ${isCurrent ? 'bg-elevated' : ''} ${draggingId === item.id ? 'opacity-50' : ''}`}
                >
                  <span className="text-xs text-t3 w-8 text-center flex-shrink-0">
                    {isCurrent ? <span className="text-accent inline-flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />Now</span> : i + 1}
                  </span>
                  {isHostOrDj && onReorderQueue && (
                    <span className="text-t3 text-sm select-none cursor-grab active:cursor-grabbing" title="Drag to reorder">
                      ||
                    </span>
                  )}
                  <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-elevated">
                    <Thumb src={item.thumbnailUrl || `https://i.ytimg.com/vi/${item.youtubeId}/hqdefault.jpg`} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${isCurrent ? 'text-accent' : 'text-t1'}`}>{item.title}</p>
                    <p className="text-xs text-t3 truncate">
                      {item.artist}
                      {item.addedByUsername ? ` - added by ${item.addedByUsername}` : ''}
                    </p>
                  </div>
                  <span className="text-xs text-t3 flex-shrink-0 font-mono">{formatDuration(Number(item.durationMs || 0))}</span>
                  {canRemove && (
                    <button onClick={() => { triggerHaptic(); onRemoveFromQueue(item.id); }} className="opacity-0 group-hover:opacity-100 text-t3 hover:text-t1 transition-opacity text-sm leading-none">
                      x
                    </button>
                  )}
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {menuTargetId && isHostOrDj && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute left-3 right-3 bottom-3 z-40 bg-surface/95 border border-[var(--border)] rounded-xl p-2 flex items-center gap-2 shadow-2xl"
          >
            <button onClick={() => handleMenuAction('next')} className="flex-1 text-xs px-2 py-2 rounded-lg bg-elevated text-t2">Play next</button>
            <button onClick={() => handleMenuAction('top')} className="flex-1 text-xs px-2 py-2 rounded-lg bg-elevated text-t2">Move top</button>
            <button onClick={() => handleMenuAction('remove')} className="flex-1 text-xs px-2 py-2 rounded-lg bg-elevated text-red-300">Remove</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
