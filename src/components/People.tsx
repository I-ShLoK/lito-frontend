'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/store';

function getInitialColor(username: string): string {
  const colors = ['#e8213a', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'];
  let hash = 0;
  for (const char of username) hash = char.charCodeAt(0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export default function People() {
  const { participants, hostId, djMode } = useStore();

  return (
    <div className="overflow-y-auto h-full px-3 py-3">
      <p className="text-[10px] uppercase tracking-widest font-medium mb-3 px-1" style={{ color: 'var(--text-3)' }}>
        {participants.length} listener{participants.length !== 1 ? 's' : ''}
      </p>

      <div className="space-y-0.5">
        {participants.map((p, i) => {
          const isHost = p.userId === hostId;
          const color = getInitialColor(p.username);

          return (
            <motion.div
              key={p.userId}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center gap-3 px-2 py-2 rounded-2xl transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--elevated)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            >
              {/* Avatar */}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ background: color, color: '#000' }}
              >
                {p.username[0].toUpperCase()}
              </div>

              <span className="flex-1 text-sm truncate" style={{ color: 'var(--text-1)' }}>{p.username}</span>

              {/* Badges */}
              <div className="flex gap-1">
                {isHost && (
                  <span
                    className="pill pill-accent"
                    style={{
                      fontSize: 10,
                      paddingTop: 2, paddingBottom: 2,
                      paddingLeft: 7, paddingRight: 7,
                    }}
                  >
                    Host
                  </span>
                )}
                {djMode && !isHost && (
                  <span
                    className="pill"
                    style={{
                      fontSize: 10,
                      paddingTop: 2, paddingBottom: 2,
                      paddingLeft: 7, paddingRight: 7,
                    }}
                  >
                    DJ
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
