'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3011';

interface UseAudioOptions {
  isHost: boolean;
  djMode: boolean;
  timeOffsetRef: React.MutableRefObject<number>;
  onTrackEnded: () => void;
  onPlay: (positionMs: number) => void;
  onPause: (positionMs: number) => void;
}

export function useAudio({
  isHost,
  djMode,
  timeOffsetRef,
  onTrackEnded,
  onPlay,
  onPause,
}: UseAudioOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const driftIntervalRef = useRef<NodeJS.Timeout>();
  const skipDriftUntilRef = useRef(0);
  const lastHardCorrectionRef = useRef(0);
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
    }
    return () => {
      if (driftIntervalRef.current) clearInterval(driftIntervalRef.current);
    };
  }, []);

  // Load track when it changes — always start fresh from pos 0
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    // Stop current playback first
    audio.pause();
    audio.src = '';

    const streamUrl = `${API_URL}/api/audio/proxy/${currentTrack.youtubeId}`;
    audio.src = streamUrl;
    audio.load();

    // Wait until the audio is ready before seeking + playing
    const handleCanPlay = () => {
      // positionMs should be 0 for a new track from the server
      const pos = Math.max(0, playbackState.positionMs);
      audio.currentTime = pos / 1000;
      if (playbackState.isPlaying) {
        audio.play().catch(() => {});
      }
      audio.removeEventListener('canplay', handleCanPlay);
    };

    audio.addEventListener('canplay', handleCanPlay);

    return () => {
      audio.removeEventListener('canplay', handleCanPlay);
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
    skipDriftUntilRef.current = Date.now() + 1200;

    if (playbackState.isPlaying) {
      if (drift > 250) {
        audio.currentTime = expectedMs / 1000;
      }
      audio.play().catch(() => {});
    } else {
      audio.pause();
      audio.playbackRate = 1;
      if (Math.abs(playbackState.positionMs - actualMs) > 150) {
        audio.currentTime = playbackState.positionMs / 1000;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackState.isPlaying, playbackState.positionMs, playbackState.timestamp]);

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

      // Avoid repeated hard seeks right after network/control events.
      if (drift > 900 && Date.now() - lastHardCorrectionRef.current > 2500) {
        audio.currentTime = expected / 1000;
        lastHardCorrectionRef.current = Date.now();
      } else if (drift > 300) {
        // Soft correction reduces audible jumps on unstable networks.
        audio.playbackRate = expected > actual ? 1.04 : 0.96;
      } else if (Math.abs(audio.playbackRate - 1) > 0.001) {
        audio.playbackRate = 1;
      }

      updateLocalPosition(actual);
    }, 1000);

    return () => clearInterval(driftIntervalRef.current);
  }, [playbackState, getExpected, updateLocalPosition]);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Audio error: silent reload — NEVER skip
    const handleError = () => {
      const currentSrc = audio.src;
      if (!currentSrc) return;
      setTimeout(() => {
        audio.src = currentSrc;
        audio.load();
        if (playbackState.isPlaying) {
          const expected = getExpected(playbackState);
          audio.currentTime = expected / 1000;
          audio.play().catch(() => {});
        }
      }, 1000);
    };

    // Natural end — only host or DJ emits TRACK_ENDED
    const handleEnded = () => {
      if (isHost || djMode) {
        onTrackEnded();
      }
    };

    audio.addEventListener('error', handleError);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [playbackState, isHost, djMode, onTrackEnded, getExpected]);

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
  }, [currentTrack, currentTrack?.youtubeId, isHost, djMode, onPlay, onPause]);

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
