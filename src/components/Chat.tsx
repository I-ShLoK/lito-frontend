'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store';

interface ChatProps {
  onSendMessage: (msg: string) => void;
}

function getInitialColor(username: string): string {
  const colors = ['#e8213a', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'];
  let hash = 0;
  for (const char of username) hash = char.charCodeAt(0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Chat({ onSendMessage }: ChatProps) {
  const messages = useStore((s) => s.messages);
  const userId = useStore((s) => s.userId);
  const [input, setInput] = useState('');
  const [showJump, setShowJump] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [unreadStartIndex, setUnreadStartIndex] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);

  const isNearBottom = () => {
    const el = listRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    const next = messages.length;
    const prev = prevLenRef.current;
    const added = next - prev;
    if (added > 0) {
      if (isNearBottom()) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        setShowJump(false); setPendingCount(0); setUnreadStartIndex(null);
      } else {
        setShowJump(true);
        setPendingCount((v) => v + added);
        if (unreadStartIndex === null) setUnreadStartIndex(prev);
      }
    }
    prevLenRef.current = next;
  }, [messages.length, unreadStartIndex]);

  const jumpToLatest = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowJump(false); setPendingCount(0); setUnreadStartIndex(null);
  };

  // Virtual scroll
  const rowHeight = 72;
  const viewportHeight = 520;
  const overscan = 5;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(messages.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  const visibleMessages = messages.slice(startIndex, endIndex);
  const topPad = startIndex * rowHeight;
  const bottomPad = Math.max(0, (messages.length - endIndex) * rowHeight);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || trimmed.length > 500) return;
    onSendMessage(trimmed);
    setInput('');
  };

  return (
    <div className="relative flex flex-col h-full min-h-0 overflow-hidden">

      {/* Messages */}
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1"
        onScroll={(e) => {
          setScrollTop((e.target as HTMLDivElement).scrollTop);
          if (isNearBottom()) { setShowJump(false); setPendingCount(0); setUnreadStartIndex(null); }
        }}
      >
        <div style={{ height: topPad }} />
        <AnimatePresence initial={false}>
          {visibleMessages.map((msg, offset) => {
            const i = startIndex + offset;
            const isOwn = msg.userId === userId;
            const color = getInitialColor(msg.username);

            return (
              <React.Fragment key={`${msg.createdAt}-${i}`}>
                {unreadStartIndex !== null && i === unreadStartIndex && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-2 py-2"
                  >
                    <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>New</span>
                    <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
                  </motion.div>
                )}

                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}
                >
                  {/* Avatar */}
                  {!isOwn && (
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                      style={{ background: color, color: '#000' }}
                    >
                      {msg.username[0].toUpperCase()}
                    </div>
                  )}

                  <div className={`max-w-[76%] flex flex-col gap-0.5 ${isOwn ? 'items-end' : 'items-start'}`}>
                    {!isOwn && (
                      <span className="text-[11px] px-1" style={{ color: 'var(--text-3)' }}>{msg.username}</span>
                    )}
                    <div
                      className="px-3 py-2 rounded-2xl text-sm break-words"
                      style={isOwn ? {
                        background: 'var(--accent)',
                        color: '#fff',
                        borderBottomRightRadius: 4,
                        boxShadow: '0 2px 12px var(--accent-glow)',
                      } : {
                        background: 'var(--elevated)',
                        color: 'var(--text-1)',
                        border: '1px solid var(--border)',
                        borderBottomLeftRadius: 4,
                      }}
                    >
                      {msg.content}
                    </div>
                    <span className="text-[10px] px-1" style={{ color: 'var(--text-3)' }}>{formatTime(msg.createdAt)}</span>
                  </div>
                </motion.div>
              </React.Fragment>
            );
          })}
        </AnimatePresence>
        <div style={{ height: bottomPad }} />
        <div ref={bottomRef} />
      </div>

      {/* Jump to latest */}
      <AnimatePresence>
        {showJump && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onClick={jumpToLatest}
            className="absolute right-4 bottom-16 z-10 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              background: 'var(--accent)',
              color: '#fff',
              boxShadow: '0 4px 16px var(--accent-glow)',
            }}
          >
            {pendingCount > 0 ? `${pendingCount} new ↓` : 'Latest ↓'}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Input */}
      <form
        onSubmit={handleSend}
        className="sticky bottom-0 p-3 flex gap-2"
        style={{ background: 'color-mix(in srgb, var(--bg) 80%, transparent)', backdropFilter: 'blur(16px)' }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 500))}
          placeholder="Say something…"
          className="flex-1 rounded-full px-4 py-2 text-sm outline-none transition-colors"
          style={{
            background: 'var(--elevated)',
            border: '1px solid var(--border)',
            color: 'var(--text-1)',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-opacity disabled:opacity-30 hover:opacity-80"
          style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 2px 10px var(--accent-glow)' }}
        >
          ↑
        </button>
      </form>
    </div>
  );
}
