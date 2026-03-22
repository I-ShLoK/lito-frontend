import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Track {
  id: string;
  youtubeId: string;
  title: string;
  artist: string;
  durationMs: number;
  thumbnailUrl: string;
}

export interface QueueItem {
  id: string;
  position: number;
  votes: number;
  addMode: string;
  addedBy: string | null;
  addedByUsername: string | null;
  trackId: string;
  youtubeId: string;
  title: string;
  artist: string;
  durationMs: number;
  thumbnailUrl: string;
}

export interface Participant {
  userId: string;
  username: string;
  joinedAt: string;
}

export interface Message {
  userId: string;
  username: string;
  content: string;
  createdAt: string;
}

export interface PlaybackState {
  trackId: string | null;
  positionMs: number;
  isPlaying: boolean;
  timestamp: number;
  isLooping: boolean;
}

interface Store {
  // Auth
  token: string | null;
  userId: string | null;
  username: string | null;
  setAuth: (token: string, userId: string, username: string) => void;
  clearAuth: () => void;

  // Room
  roomId: string | null;
  roomSlug: string | null;
  roomName: string | null;
  hostId: string | null;
  djMode: boolean;
  participants: Participant[];
  messages: Message[];

  // Playback
  currentTrack: Track | null;
  queue: QueueItem[];
  playbackState: PlaybackState;
  localPositionMs: number;
  unplayableTracks: Set<string>;

  // UI
  theme: 'default' | 'mono';
  toggleTheme: () => void;
  activeTab: 'browse' | 'player' | 'chat' | 'people';
  setActiveTab: (tab: 'browse' | 'player' | 'chat' | 'people') => void;

  // Actions
  setRoom: (roomId: string, slug: string, name: string, hostId: string) => void;
  clearRoom: () => void;
  setQueue: (queue: QueueItem[]) => void;
  setCurrentTrack: (track: Track | null) => void;
  setPlaybackState: (state: PlaybackState) => void;
  updateLocalPosition: (ms: number) => void;
  addMessage: (msg: Message) => void;
  setParticipants: (p: Participant[]) => void;
  setDjMode: (enabled: boolean) => void;
  markTrackUnplayable: (trackId: string) => void;
  setHost: (hostId: string) => void;
  addParticipant: (p: Participant) => void;
  removeParticipant: (userId: string) => void;
}

const defaultPlaybackState: PlaybackState = {
  trackId: null,
  positionMs: 0,
  isPlaying: false,
  timestamp: Date.now(),
  isLooping: false,
};

export const useStore = create<Store>()(
  persist(
    (set) => ({
      // Auth
      token: null,
      userId: null,
      username: null,
      setAuth: (token, userId, username) => set({ token, userId, username }),
      clearAuth: () => set({ token: null, userId: null, username: null }),

      // Room
      roomId: null,
      roomSlug: null,
      roomName: null,
      hostId: null,
      djMode: false,
      participants: [],
      messages: [],

      // Playback
      currentTrack: null,
      queue: [],
      playbackState: defaultPlaybackState,
      localPositionMs: 0,
      unplayableTracks: new Set(),

      // UI
      theme: 'default',
      toggleTheme: () =>
        set((s) => {
          const next = s.theme === 'default' ? 'mono' : 'default';
          if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('data-theme', next === 'mono' ? 'mono' : '');
          }
          return { theme: next };
        }),
      activeTab: 'browse',
      setActiveTab: (tab) => set({ activeTab: tab }),

      // Actions
      setRoom: (roomId, slug, name, hostId) =>
        set({ roomId, roomSlug: slug, roomName: name, hostId }),
      clearRoom: () =>
        set({
          roomId: null, roomSlug: null, roomName: null, hostId: null,
          djMode: false, participants: [], messages: [],
          currentTrack: null, queue: [],
          playbackState: defaultPlaybackState, localPositionMs: 0,
          unplayableTracks: new Set(),
        }),
      setQueue: (queue) => set({ queue }),
      setCurrentTrack: (currentTrack) => set({ currentTrack }),
      setPlaybackState: (playbackState) => set({ playbackState }),
      updateLocalPosition: (localPositionMs) => set({ localPositionMs }),
      addMessage: (msg) =>
        set((s) => ({ messages: [...s.messages.slice(-499), msg] })),
      setParticipants: (participants) => set({ participants }),
      setDjMode: (djMode) => set({ djMode }),
      markTrackUnplayable: (trackId) =>
        set((s) => {
          const next = new Set(Array.from(s.unplayableTracks));
          next.add(trackId);
          return { unplayableTracks: next };
        }),
      setHost: (hostId) => set({ hostId }),
      addParticipant: (p) =>
        set((s) => ({
          participants: s.participants.some((x) => x.userId === p.userId)
            ? s.participants
            : [...s.participants, p],
        })),
      removeParticipant: (userId) =>
        set((s) => ({
          participants: s.participants.filter((p) => p.userId !== userId),
        })),
    }),
    {
      name: 'lito-store',
      partialize: (s) => ({ token: s.token, userId: s.userId, username: s.username, theme: s.theme }),
    }
  )
);
