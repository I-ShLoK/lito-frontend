'use client';

import React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import Thumb from './Thumb';

interface RoomCardProps {
  id: string;
  slug: string;
  name: string;
  participantCount: number;
  thumbnailUrl?: string;
  trackTitle?: string;
  trackArtist?: string;
  hostUsername?: string;
  compact?: boolean;
}

export default function RoomCard({
  slug, name, participantCount, thumbnailUrl, trackTitle, trackArtist, hostUsername, compact
}: RoomCardProps) {
  return (
    <Link href={`/room/${slug}`}>
      <motion.div
        whileHover={{ y: -3, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
        transition={{ duration: 0.2 }}
        className={`relative overflow-hidden rounded-[var(--radius)] bg-surface border border-[var(--border)] cursor-pointer ${compact ? 'h-24' : 'h-48'}`}
      >
        {/* Background art */}
        {thumbnailUrl ? (
          <>
            <Thumb src={thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
            <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/60 to-transparent" />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-elevated to-bg" />
        )}

        {/* Content */}
        <div className="absolute inset-0 p-4 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              <span className="text-xs text-accent font-medium uppercase tracking-wider">Live</span>
            </div>
            <div className="flex items-center gap-1 bg-black/40 backdrop-blur-sm rounded-full px-2 py-0.5">
              <span className="text-xs text-t2">👥</span>
              <span className="text-xs text-t1 font-medium">{participantCount}</span>
            </div>
          </div>

          <div>
            <h3 className="font-display font-600 text-t1 truncate text-lg leading-tight">
              {name}
            </h3>
            {trackTitle && (
              <p className="text-xs text-t2 truncate mt-0.5">
                {trackTitle} {trackArtist ? `— ${trackArtist}` : ''}
              </p>
            )}
            {hostUsername && !trackTitle && (
              <p className="text-xs text-t3 truncate mt-0.5">hosted by {hostUsername}</p>
            )}
          </div>
        </div>
      </motion.div>
    </Link>
  );
}

export function RoomCardSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className={`skeleton rounded-[var(--radius)] ${compact ? 'h-24' : 'h-48'}`} />
  );
}
