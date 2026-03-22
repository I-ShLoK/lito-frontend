'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useStore, Track, QueueItem, Participant, Message, PlaybackState } from '@/store';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3011';

let globalSocket: Socket | null = null;
let globalSocketToken: string | null = null;

function mapQueueItems(rawQueue: Record<string, unknown>[]): QueueItem[] {
  return rawQueue.map((q) => ({
    id: String(q.id),
    position: Number(q.position ?? 0),
    votes: Number(q.votes ?? 0),
    addMode: String(q.addMode ?? q.add_mode ?? 'end'),
    addedBy: (q.addedBy ?? q.added_by ?? null) as string | null,
    addedByUsername: (q.addedByUsername ?? q.added_by_username ?? null) as string | null,
    trackId: String(q.trackId ?? q.track_id ?? ''),
    youtubeId: String(q.youtubeId ?? q.youtube_id ?? ''),
    title: String(q.title ?? 'Unknown'),
    artist: String(q.artist ?? 'Unknown'),
    durationMs: Number(q.durationMs ?? q.duration_ms ?? 0),
    thumbnailUrl: String(q.thumbnailUrl ?? q.thumbnail_url ?? ''),
  }));
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const {
    token, userId,
    setQueue, setCurrentTrack, setPlaybackState,
    addMessage, setParticipants, setDjMode, markTrackUnplayable,
    setHost, addParticipant, removeParticipant, roomId,
    updateLocalPosition,
  } = useStore();

  const timeOffsetRef = useRef(0);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Run NTP sync N times, keep the sample with lowest RTT for best accuracy
  const doNtpSync = useCallback((socket: Socket, samples = 3) => {
    let best = { rtt: Infinity, offset: 0 };
    let done = 0;

    const runSample = () => {
      let completed = false;
      const sentAt = Date.now();
      socket.emit('SYNC_REQUEST');
      const timeout = setTimeout(() => {
        if (completed) return;
        completed = true;
        done++;
        if (done < samples) setTimeout(runSample, 200);
      }, 1500);

      socket.once('SYNC_RESPONSE', (response: { state: PlaybackState; serverNow: number }) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        const rtt = Date.now() - sentAt;
        const offset = (response.serverNow + rtt / 2) - Date.now();
        if (rtt < best.rtt) {
          best = { rtt, offset };
          timeOffsetRef.current = offset;
        }
        done++;
        if (done < samples) setTimeout(runSample, 200);
      });
    };
    runSample();
  }, []);

  const getSocket = useCallback(() => {
    const tokenChanged = globalSocketToken !== token;
    if (globalSocket && tokenChanged) {
      globalSocket.disconnect();
      globalSocket = null;
    }

    if (!globalSocket || !globalSocket.connected) {
      globalSocket = io(SOCKET_URL, {
        auth: { token },
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 10,
      });
      globalSocketToken = token;
    }
    socketRef.current = globalSocket;
    return globalSocket;
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket();

    socket.on('connect', () => {
      console.log('Socket connected');
      if (roomId) {
        socket.emit('JOIN_ROOM', { roomId });
        doNtpSync(socket, 5);
      }
    });

    socket.on('ROOM_STATE', ({ playbackState, queue, participants, djMode }: {
      playbackState: PlaybackState;
      queue: Record<string, unknown>[];
      participants: Participant[];
      djMode: boolean;
    }) => {
      setPlaybackState(playbackState);
      setQueue(mapQueueItems(queue));
      setParticipants(participants);
      setDjMode(djMode);
    });

    socket.on('QUEUE_UPDATED', ({ queue }: { queue: Record<string, unknown>[] }) => {
      setQueue(mapQueueItems(queue));
    });

    socket.on('TRACK_CHANGED', ({ track, positionMs, timestamp }: { track: Track | null; positionMs?: number; timestamp?: number }) => {
      setCurrentTrack(track);
      // Always reset position to 0 (or server-provided) when track changes
      setPlaybackState({
        ...useStore.getState().playbackState,
        trackId: track?.youtubeId || null,
        positionMs: positionMs ?? 0,
        timestamp: timestamp ?? Date.now(),
        isPlaying: track !== null,
      });
      updateLocalPosition(0);
    });

    socket.on('PLAY', (state: { positionMs: number; timestamp: number }) => {
      setPlaybackState({
        ...useStore.getState().playbackState,
        isPlaying: true,
        positionMs: state.positionMs,
        timestamp: state.timestamp,
      });
    });

    socket.on('PAUSE', (state: { positionMs: number; timestamp: number }) => {
      setPlaybackState({
        ...useStore.getState().playbackState,
        isPlaying: false,
        positionMs: state.positionMs,
        timestamp: state.timestamp,
      });
    });

    socket.on('SEEK', (state: { positionMs: number; timestamp: number }) => {
      setPlaybackState({
        ...useStore.getState().playbackState,
        positionMs: state.positionMs,
        timestamp: state.timestamp,
      });
    });

    socket.on('PARTICIPANT_JOINED', (p: { userId: string; username: string }) => {
      addParticipant({ userId: p.userId, username: p.username, joinedAt: new Date().toISOString() });
    });

    socket.on('PARTICIPANT_LEFT', ({ userId: leftUserId }: { userId: string }) => {
      removeParticipant(leftUserId);
    });

    socket.on('HOST_CHANGED', ({ newHostId, newHostUsername }: { newHostId: string; newHostUsername: string }) => {
      setHost(newHostId);
      toast(`👑 ${newHostUsername} is now hosting`, { duration: 4000 });
    });

    socket.on('CHAT_MESSAGE', (msg: Message) => {
      addMessage(msg);
    });

    socket.on('TOGGLE_DJ_MODE', ({ djMode }: { djMode: boolean }) => {
      setDjMode(djMode);
      toast(djMode ? '⚡ DJ Mode ON — everyone can control' : '🎧 DJ Mode OFF', { duration: 3000 });
    });

    socket.on('TRACK_UNPLAYABLE', ({ trackId, reason }: { trackId: string; reason: string }) => {
      markTrackUnplayable(trackId);
      toast.error(`⚠️ ${reason}`, { duration: 5000 });
    });

    socket.on('ERROR', ({ message }: { message: string }) => {
      toast.error(message);
    });

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
      socket.off('connect');
      socket.off('ROOM_STATE');
      socket.off('QUEUE_UPDATED');
      socket.off('TRACK_CHANGED');
      socket.off('PLAY');
      socket.off('PAUSE');
      socket.off('SEEK');
      socket.off('PARTICIPANT_JOINED');
      socket.off('PARTICIPANT_LEFT');
      socket.off('HOST_CHANGED');
      socket.off('CHAT_MESSAGE');
      socket.off('TOGGLE_DJ_MODE');
      socket.off('TRACK_UNPLAYABLE');
      socket.off('ERROR');
    };
  }, [token, roomId, getSocket, setQueue, setCurrentTrack, setPlaybackState,
      addMessage, setParticipants, setDjMode, markTrackUnplayable,
      setHost, addParticipant, removeParticipant, updateLocalPosition, doNtpSync]);

  useEffect(() => {
    if (!token || !roomId) return;
    const socket = socketRef.current || getSocket();
    doNtpSync(socket, 5);

    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    syncIntervalRef.current = setInterval(() => {
      if (socket.connected) doNtpSync(socket, 3);
    }, 30000);

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };
  }, [token, roomId, getSocket, doNtpSync]);

  const emit = useCallback((event: string, data?: unknown) => {
    const socket = socketRef.current || getSocket();
    socket.emit(event, data);
  }, [getSocket]);

  const joinRoom = useCallback((roomId: string) => {
    const socket = socketRef.current || getSocket();
    socket.emit('JOIN_ROOM', { roomId });
    doNtpSync(socket, 5);
  }, [getSocket, doNtpSync]);
  const leaveRoom = useCallback((roomId: string) => emit('LEAVE_ROOM', { roomId }), [emit]);
  const play = useCallback((positionMs: number) => emit('PLAY', { positionMs }), [emit]);
  const pause = useCallback((positionMs: number) => emit('PAUSE', { positionMs }), [emit]);
  const seek = useCallback((positionMs: number) => emit('SEEK', { positionMs }), [emit]);
  const skipNext = useCallback(() => emit('SKIP_NEXT'), [emit]);
  const skipPrev = useCallback(() => emit('SKIP_PREV'), [emit]);
  const toggleLoop = useCallback(() => emit('TOGGLE_LOOP'), [emit]);
  const sendChat = useCallback((message: string) => emit('CHAT', { message }), [emit]);
  const toggleDjMode = useCallback(() => emit('TOGGLE_DJ_MODE'), [emit]);
  const trackEnded = useCallback(() => emit('TRACK_ENDED'), [emit]);
  const syncRequest = useCallback(() => {
    const socket = socketRef.current || getSocket();
    doNtpSync(socket, 3);
  }, [getSocket, doNtpSync]);

  const addToQueue = useCallback((item: {
    youtubeId: string; title: string; artist: string;
    durationMs: number; thumbnailUrl: string; mode: 'next' | 'end';
  }) => emit('ADD_TO_QUEUE', item), [emit]);

  const removeFromQueue = useCallback((queueItemId: string) =>
    emit('REMOVE_FROM_QUEUE', { queueItemId }), [emit]);

  const reorderQueue = useCallback((queueItemId: string, newIndex: number) =>
    emit('REORDER_QUEUE', { queueItemId, newIndex }), [emit]);

  return {
    socket: socketRef.current,
    timeOffsetRef,
    joinRoom, leaveRoom, play, pause, seek,
    skipNext, skipPrev, toggleLoop, sendChat,
    toggleDjMode, trackEnded, syncRequest,
    addToQueue, removeFromQueue, reorderQueue,
    emit,
  };
}
