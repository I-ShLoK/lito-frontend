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
  featured?: boolean;
}

export default function RoomCard({
  slug, name, participantCount, thumbnailUrl, trackTitle, trackArtist, hostUsername, compact, featured,
}: RoomCardProps) {
  if (featured) {
    return (
      <Link href={`/room/${slug}`}>
        <motion.div
          whileHover={{ scale: 1.005 }}
          transition={{ duration: 0.2 }}
          className="relative overflow-hidden rounded-3xl cursor-pointer"
          style={{ height: 220, border: '1px solid var(--border)' }}
        >
          {/* Background art */}
          {thumbnailUrl ? (
            <>
              <Thumb src={thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ opacity: 0.45 }} />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, rgba(10,0,0,0.95) 30%, rgba(10,0,0,0.4) 100%)' }} />
            </>
          ) : (
            <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, var(--elevated) 0%, var(--bg) 100%)' }} />
          )}

          {/* Content */}
          <div className="absolute inset-0 p-7 flex flex-col justify-between">
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full live-dot flex-shrink-0"
                style={{ background: 'var(--accent)' }}
              />
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>Live</span>
              <span className="mx-1" style={{ color: 'var(--text-3)' }}>·</span>
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>👥 {participantCount}</span>
            </div>

            <div>
              <h2 className="font-display text-3xl leading-tight mb-1 max-w-lg" style={{ color: 'var(--text-1)' }}>
                {name}
              </h2>
              {trackTitle && (
                <p className="text-sm" style={{ color: 'var(--text-2)' }}>
                  {trackTitle}{trackArtist ? ` — ${trackArtist}` : ''}
                </p>
              )}
              {!trackTitle && hostUsername && (
                <p className="text-sm" style={{ color: 'var(--text-3)' }}>hosted by {hostUsername}</p>
              )}
              <div className="mt-4">
                <span
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-opacity hover:opacity-80"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  Join Room →
                </span>
              </div>
            </div>
          </div>

          {/* Thumbnail pill (right side) */}
          {thumbnailUrl && (
            <div className="absolute right-6 top-1/2 -translate-y-1/2 hidden sm:block">
              <div className="w-28 h-28 rounded-2xl overflow-hidden shadow-2xl" style={{ border: '2px solid rgba(255,255,255,0.12)' }}>
                <Thumb src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
              </div>
            </div>
          )}
        </motion.div>
      </Link>
    );
  }

  // Standard card
  return (
    <Link href={`/room/${slug}`}>
      <motion.div
        whileHover={{ y: -4, boxShadow: '0 16px 40px rgba(0,0,0,0.6)' }}
        transition={{ duration: 0.2 }}
        className="relative overflow-hidden rounded-2xl cursor-pointer"
        style={{
          height: compact ? 96 : 160,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      >
        {thumbnailUrl ? (
          <>
            <Thumb src={thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ opacity: 0.28 }} />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, var(--bg) 20%, transparent 80%)' }} />
          </>
        ) : (
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, var(--elevated) 0%, var(--bg) 100%)' }} />
        )}

        <div className="absolute inset-0 p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full live-dot" style={{ background: 'var(--accent)' }} />
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Live</span>
            </div>
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
              style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', color: 'var(--text-2)' }}
            >
              👥 {participantCount}
            </span>
          </div>

          <div>
            <h3 className="font-display font-600 text-base leading-tight truncate" style={{ color: 'var(--text-1)' }}>
              {name}
            </h3>
            {trackTitle && (
              <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                {trackTitle}{trackArtist ? ` — ${trackArtist}` : ''}
              </p>
            )}
            {!trackTitle && hostUsername && (
              <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>by {hostUsername}</p>
            )}
          </div>
        </div>
      </motion.div>
    </Link>
  );
}

export function RoomCardSkeleton({ featured, compact }: { featured?: boolean; compact?: boolean }) {
  return (
    <div
      className="skeleton rounded-2xl"
      style={{ height: featured ? 220 : compact ? 96 : 160 }}
    />
  );
}
