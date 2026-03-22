'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/store';

function getInitialColor(username: string): string {
  const colors = ['#c8f135', '#f135c8', '#35c8f1', '#f1c835', '#c835f1', '#35f1c8'];
  let hash = 0;
  for (const char of username) hash = char.charCodeAt(0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export default function People() {
  const { participants, hostId, djMode } = useStore();

  return (
    <div className="overflow-y-auto h-full px-3 py-3">
      <p className="text-xs text-t3 uppercase tracking-widest mb-3 px-1">
        {participants.length} listener{participants.length !== 1 ? 's' : ''}
      </p>
      <div className="space-y-1">
        {participants.map((p, i) => {
          const isHost = p.userId === hostId;
          const color = getInitialColor(p.username);
          return (
            <motion.div
              key={p.userId}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center gap-3 px-2 py-2 rounded-[var(--radius)] hover:bg-elevated transition-colors"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ background: color, color: '#000' }}
              >
                {p.username[0].toUpperCase()}
              </div>
              <span className="flex-1 text-sm text-t1 truncate">{p.username}</span>
              <div className="flex gap-1">
                {isHost && <span title="Host">👑</span>}
                {djMode && !isHost && <span title="DJ Mode">⚡</span>}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
