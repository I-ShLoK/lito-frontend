'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3011';

function shouldPreferProxy(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod|android|mobile/.test(ua);
}

function sourceUrl(mode: 'proxy' | 'stream', youtubeId?: string): string {
  if (!youtubeId) return '';
  return mode === 'proxy'
    ? `${API_URL}/api/audio/proxy/${youtubeId}`
    : `${API_URL}/api/audio/stream/${youtubeId}`;
}

interface UseAudioOptions {
  volume: number;
  timeOffsetRef: React.MutableRefObject<number>;
  onTrackEnded: (endedTrackId?: string) => void;
  onPlay: (positionMs: number) => void;
  onPause: (positionMs: number) => void;
}

export function useAudio({
  volume,
  timeOffsetRef,
  onTrackEnded,
  onPlay,
  onPause,
}: UseAudioOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const driftIntervalRef = useRef<NodeJS.Timeout>();
  const resumeWatchRef = useRef<NodeJS.Timeout>();
  const startFallbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const skipDriftUntilRef = useRef(0);
  const lastHardCorrectionRef = useRef(0);
  const pendingPlayRef = useRef(false);
  const sourceModeRef = useRef<'proxy' | 'stream'>(shouldPreferProxy() ? 'proxy' : 'stream');
  const consecutiveErrorRef = useRef(0);
  const { playbackState, currentTrack, updateLocalPosition } = useStore();

  const getExpected = useCallback((state: typeof playbackState): number => {
    if (!state.isPlaying) return state.positionMs;
    const elapsed = Math.max(0, Date.now() + timeOffsetRef.current - state.timestamp);
    return state.positionMs + elapsed;
  }, [timeOffsetRef]);

  // Init audio element
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = 'auto';
      audioRef.current.crossOrigin = 'anonymous';
      audioRef.current.autoplay = false;
      (audioRef.current as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    }
    return () => {
      if (driftIntervalRef.current) clearInterval(driftIntervalRef.current);
      if (resumeWatchRef.current) clearInterval(resumeWatchRef.current);
      if (startFallbackTimeoutRef.current) clearTimeout(startFallbackTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.min(1, Math.max(0, volume));
  }, [volume]);

  // Load track when it changes; always start fresh and recover on slow readiness
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    audio.pause();
    audio.src = '';
    sourceModeRef.current = shouldPreferProxy() ? 'proxy' : 'stream';
    consecutiveErrorRef.current = 0;

    audio.src = sourceUrl(sourceModeRef.current, currentTrack.youtubeId);
    audio.load();

    const syncAndTryPlay = () => {
      const pos = Math.max(0, playbackState.positionMs);
      audio.currentTime = pos / 1000;
      if (!playbackState.isPlaying) return;

      audio.play().then(() => {
        pendingPlayRef.current = false;
      }).catch(() => {
        // Usually autoplay/gesture restriction. We'll retry on user interaction.
        pendingPlayRef.current = true;
      });
    };

    const handleCanPlayOrMetadata = () => {
      syncAndTryPlay();
      audio.removeEventListener('canplay', handleCanPlayOrMetadata);
      audio.removeEventListener('loadedmetadata', handleCanPlayOrMetadata);
    };

    audio.addEventListener('canplay', handleCanPlayOrMetadata);
    audio.addEventListener('loadedmetadata', handleCanPlayOrMetadata);

    if (startFallbackTimeoutRef.current) clearTimeout(startFallbackTimeoutRef.current);
    startFallbackTimeoutRef.current = setTimeout(() => {
      if (!playbackState.isPlaying) return;
      if (audio.readyState < 2) return;
      syncAndTryPlay();
    }, 2500);

    return () => {
      if (startFallbackTimeoutRef.current) {
        clearTimeout(startFallbackTimeoutRef.current);
        startFallbackTimeoutRef.current = null;
      }
      audio.removeEventListener('canplay', handleCanPlayOrMetadata);
      audio.removeEventListener('loadedmetadata', handleCanPlayOrMetadata);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.youtubeId]);

  // Sync playback state changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const expectedMs = getExpected(playbackState);
    const actualMs = audio.currentTime * 1000;
    const drift = Math.abs(expectedMs - actualMs);
    // Briefly pause drift nudges after authoritative server state updates.
    skipDriftUntilRef.current = Date.now() + 900;

    if (playbackState.isPlaying) {
      if (drift > 420) {
        audio.currentTime = expectedMs / 1000;
      }
      audio.play().then(() => {
        pendingPlayRef.current = false;
      }).catch(() => {
        pendingPlayRef.current = true;
      });
    } else {
      audio.pause();
      pendingPlayRef.current = false;
      audio.playbackRate = 1;
      if (Math.abs(playbackState.positionMs - actualMs) > 250) {
        audio.currentTime = playbackState.positionMs / 1000;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackState.isPlaying, playbackState.positionMs, playbackState.timestamp]);

  // If autoplay is blocked, retry once user interacts.
  useEffect(() => {
    const retryPendingPlay = () => {
      const audio = audioRef.current;
      if (!audio || !pendingPlayRef.current || !playbackState.isPlaying) return;
      audio.play().then(() => {
        pendingPlayRef.current = false;
      }).catch(() => {});
    };

    window.addEventListener('pointerdown', retryPendingPlay);
    window.addEventListener('keydown', retryPendingPlay);

    return () => {
      window.removeEventListener('pointerdown', retryPendingPlay);
      window.removeEventListener('keydown', retryPendingPlay);
    };
  }, [playbackState.isPlaying]);

  // Recovery watchdog: if we should be playing but audio got paused/stalled, retry.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    resumeWatchRef.current = setInterval(() => {
      if (!playbackState.isPlaying) return;
      if (!currentTrack) return;
      if (!audio.paused) return;
      if (audio.readyState < 2) return;

      const expected = getExpected(playbackState);
      const drift = Math.abs(expected - audio.currentTime * 1000);
      if (drift > 1000) {
        audio.currentTime = expected / 1000;
      }
      audio.play().then(() => {
        pendingPlayRef.current = false;
      }).catch(() => {
        pendingPlayRef.current = true;
      });
    }, 2000);

    return () => {
      if (resumeWatchRef.current) {
        clearInterval(resumeWatchRef.current);
        resumeWatchRef.current = undefined;
      }
    };
  }, [playbackState, currentTrack, getExpected]);

  // When app returns to foreground/screen turns on, force local playback recovery.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const recoverOnVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!playbackState.isPlaying || !currentTrack) return;

      const expected = getExpected(playbackState);
      if (Math.abs(expected - audio.currentTime * 1000) > 1200) {
        audio.currentTime = expected / 1000;
      }
      audio.play().then(() => {
        pendingPlayRef.current = false;
      }).catch(() => {
        pendingPlayRef.current = true;
      });
    };

    document.addEventListener('visibilitychange', recoverOnVisible);
    window.addEventListener('focus', recoverOnVisible);
    window.addEventListener('pageshow', recoverOnVisible);
    return () => {
      document.removeEventListener('visibilitychange', recoverOnVisible);
      window.removeEventListener('focus', recoverOnVisible);
      window.removeEventListener('pageshow', recoverOnVisible);
    };
  }, [playbackState, currentTrack, getExpected]);

  // Drift correction + position tracking
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    driftIntervalRef.current = setInterval(() => {
      if (!playbackState.isPlaying) return;
      if (Date.now() < skipDriftUntilRef.current) return;

      const expected = getExpected(playbackState);
      const actual = audio.currentTime * 1000;
      const drift = Math.abs(expected - actual);

      if (drift > 1000 && Date.now() - lastHardCorrectionRef.current > 3000) {
        audio.currentTime = expected / 1000;
        lastHardCorrectionRef.current = Date.now();
      } else if (drift > 450) {
        audio.playbackRate = expected > actual ? 1.04 : 0.96;
      } else if (Math.abs(audio.playbackRate - 1) > 0.001) {
        audio.playbackRate = 1;
      }

      updateLocalPosition(Math.abs(expected - actual) > 220 ? expected : actual);
    }, 250);

    return () => clearInterval(driftIntervalRef.current);
  }, [playbackState, getExpected, updateLocalPosition]);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleError = () => {
      const currentSrc = audio.src;
      if (!currentSrc) return;
      consecutiveErrorRef.current += 1;

      if (sourceModeRef.current === 'stream') {
        sourceModeRef.current = 'proxy';
        audio.src = sourceUrl('proxy', currentTrack?.youtubeId);
        audio.load();
        return;
      }

      if (sourceModeRef.current === 'proxy') {
        sourceModeRef.current = 'stream';
        audio.src = sourceUrl('stream', currentTrack?.youtubeId);
        audio.load();
        return;
      }

      if (consecutiveErrorRef.current >= 2) {
        onTrackEnded(currentTrack?.youtubeId);
        return;
      }

      setTimeout(() => {
        audio.src = currentSrc;
        audio.load();
        if (playbackState.isPlaying) {
          const expected = getExpected(playbackState);
          audio.currentTime = expected / 1000;
          audio.play().then(() => {
            pendingPlayRef.current = false;
          }).catch(() => {
            pendingPlayRef.current = true;
          });
        }
      }, 1000);
    };

    const handleEnded = () => {
      onTrackEnded(currentTrack?.youtubeId);
    };

    const recoverPlayback = () => {
      if (!playbackState.isPlaying || !currentTrack) return;
      if (audio.readyState < 2) return;
      const expected = getExpected(playbackState);
      if (Math.abs(expected - audio.currentTime * 1000) > 1200) {
        audio.currentTime = expected / 1000;
      }
      audio.play().then(() => {
        pendingPlayRef.current = false;
      }).catch(() => {
        pendingPlayRef.current = true;
      });
    };

    const handleWaiting = () => {
      setTimeout(recoverPlayback, 400);
    };

    const handleStalled = () => {
      setTimeout(recoverPlayback, 500);
    };

    const handlePause = () => {
      // Unexpected pause while we should be playing.
      if (!playbackState.isPlaying) return;
      setTimeout(recoverPlayback, 200);
    };

    audio.addEventListener('error', handleError);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('stalled', handleStalled);
    audio.addEventListener('pause', handlePause);

    return () => {
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('stalled', handleStalled);
      audio.removeEventListener('pause', handlePause);
    };
  }, [playbackState, onTrackEnded, getExpected, currentTrack, currentTrack?.youtubeId]);

  // MediaSession API
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist || 'Unknown',
      artwork: [{ src: currentTrack.thumbnailUrl || '', sizes: '512x512', type: 'image/jpeg' }],
    });

    const audio = audioRef.current;

    navigator.mediaSession.setActionHandler('play', () => {
      if (audio) onPlay(audio.currentTime * 1000);
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      if (audio) onPause(audio.currentTime * 1000);
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      // Handled by socket skipNext
    });
  }, [currentTrack, currentTrack?.youtubeId, onPlay, onPause]);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playbackState.isPlaying) {
      onPause(audio.currentTime * 1000);
    } else {
      onPlay(audio.currentTime * 1000);
    }
  }, [playbackState.isPlaying, onPlay, onPause]);

  const seekTo = useCallback((positionMs: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = positionMs / 1000;
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, []);

  return { audioRef, togglePlayPause, seekTo, setMuted, getExpected };
}
