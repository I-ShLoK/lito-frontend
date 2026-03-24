'use client';

import React from 'react';

interface VisualizerProps {
  isPlaying: boolean;
  bars?: number;
  className?: string;
}

export default function Visualizer({ isPlaying, bars = 36, className = '' }: VisualizerProps) {
  return (
    <div className={`flex items-end gap-[2px] ${className}`} style={{ height: 28 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const height = 6 + Math.random() * 22;
        const delay = (i / bars) * 900;
        const duration = 550 + Math.random() * 700;
        return (
          <div
            key={i}
            className={`waveform-bar no-theme-transition ${isPlaying ? '' : 'paused'}`}
            style={{
              height: `${height}px`,
              animationDuration: `${duration}ms`,
              animationDelay: `${delay}ms`,
              // waveform-bar already uses var(--adapt-primary) via CSS
            }}
          />
        );
      })}
    </div>
  );
}
