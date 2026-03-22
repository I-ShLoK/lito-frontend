'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store';

interface ChatProps {
  onSendMessage: (msg: string) => void;
}

function getInitialColor(username: string): string {
  const colors = ['#c8f135', '#f135c8', '#35c8f1', '#f1c835', '#c835f1', '#35f1c8'];
  let hash = 0;
  for (const char of username) hash = char.charCodeAt(0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Chat({ onSendMessage }: ChatProps) {
  const { messages, userId } = useStore();
  const [input, setInput] = useState('');
  const [showJump, setShowJump] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [unreadStartIndex, setUnreadStartIndex] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevLenRef = useRef(0);

  const isNearBottom = () => {
    const el = listRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 36;
  };

  useEffect(() => {
    const next = messages.length;
    const prev = prevLenRef.current;
    const added = next - prev;
    if (added > 0) {
      if (isNearBottom()) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        setShowJump(false);
        setPendingCount(0);
        setUnreadStartIndex(null);
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
    setShowJump(false);
    setPendingCount(0);
    setUnreadStartIndex(null);
  };

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
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2"
        onScroll={() => {
          if (isNearBottom()) {
            setShowJump(false);
            setPendingCount(0);
            setUnreadStartIndex(null);
          }
        }}
      >
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => {
            const isOwn = msg.userId === userId;
            const color = getInitialColor(msg.username);
            return (
              <React.Fragment key={`${msg.createdAt}-${i}`}>
              {unreadStartIndex !== null && i === unreadStartIndex && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 py-1"
                >
                  <div className="h-px bg-[var(--border)] flex-1" />
                  <span className="text-[10px] uppercase tracking-wider text-t3">New</span>
                  <div className="h-px bg-[var(--border)] flex-1" />
                </motion.div>
              )}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}
              >
                {!isOwn && (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                    style={{ background: color, color: '#000' }}
                  >
                    {msg.username[0].toUpperCase()}
                  </div>
                )}
                <div className={`max-w-[75%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                  {!isOwn && (
                    <span className="text-xs text-t3 px-1">{msg.username}</span>
                  )}
                  <div
                    className={`px-3 py-1.5 rounded-2xl text-sm break-words break-all ${
                      isOwn
                        ? 'bg-accent text-bg rounded-tr-sm'
                        : 'bg-elevated text-t1 rounded-tl-sm'
                    }`}
                  >
                    {msg.content}
                  </div>
                  <span className="text-xs text-t3 px-1">{formatTime(msg.createdAt)}</span>
                </div>
              </motion.div>
              </React.Fragment>
            );
          })}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      <AnimatePresence>
        {showJump && (
          <motion.button
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            onClick={jumpToLatest}
            className="absolute right-4 bottom-16 z-10 px-3 py-1.5 rounded-full apple-glass text-xs text-t1"
          >
            {pendingCount > 0 ? `${pendingCount} new` : 'Jump to latest'}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Input */}
      <form onSubmit={handleSend} className="sticky bottom-0 p-3 flex gap-2 bg-bg/70 backdrop-blur-md">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 500))}
          placeholder="Say something..."
          className="flex-1 bg-elevated border border-[var(--border)] rounded-full px-4 py-2 text-sm text-t1 placeholder:text-t3 outline-none focus:border-accent transition-colors"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="w-9 h-9 rounded-full bg-accent text-bg flex items-center justify-center disabled:opacity-30 hover:opacity-80 transition-opacity font-bold"
        >
          ↑
        </button>
      </form>
    </div>
  );
}
