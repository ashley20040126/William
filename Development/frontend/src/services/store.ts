import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setToken } from '@/services/api';
import type { PathDef, PracticeItem } from '@/services/journeyApi';

// ── Types ──
export interface ChatAttachment {
  id?: number;
  name: string;
  path: string;
  type: string;
  size: number;
  kind?: 'image' | 'document' | 'audio' | 'video' | 'other';
  status?: 'uploaded' | 'processing' | 'ready' | 'failed';
  summary?: string;
  excerpt?: string;
  ocrText?: string;
  meta?: Record<string, unknown>;
}
export interface ScheduleCandidate {
  id: number;
  sourceMessageId?: number;
  title: string;
  startTime: string | null;
  endTime?: string | null;
  dateText: string;
  location: string;
  participants: string[];
  confidence: number;
  status: 'candidate' | 'confirmed' | 'dismissed' | 'edited';
  meta?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
  confirmedAt?: string | null;
  dismissedAt?: string | null;
}
export interface ChatMsg {
  id?: number;
  clientId?: string;
  role: 'user' | 'assistant';
  content: string;
  ts: string;
  voiceId?: string;
  attachments?: ChatAttachment[];
  scheduleCandidates?: ScheduleCandidate[];
  practiceSuggestions?: Array<{
    id: string;
    rawId: number | null;
    title: string;
    description: string;
    recommendedTime: string | null;
    actionPrompt: string | null;
    status: 'pending' | 'completed';
    completedAt: string | null;
    saved?: boolean;
    suggestionDate?: string | null;
  }>;
}
export interface MoodEntry {
  mood: number;
  stress: number;
  note: string;
  ts: string;
}
export interface JournalEntry {
  id?: number;
  date: string;
  text: string;
  mood?: number | null;
  stress?: number | null;
  analysis?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
  attachments?: ChatAttachment[];
}
export interface Insight {
  title: string;
  detail: string;
  type: 'warning' | 'positive' | 'neutral';
  severity?: string;
}
export interface TodayFeed {
  greeting: string;
  timeSlot: 'morning' | 'midday' | 'evening';
  insight: Insight | null;
  voiceInsight: {
    date: string;
    severity: 'warning' | 'positive' | 'neutral';
    sampleCount: number;
    transcriptTokens: number;
    averageStress: number | null;
    highStressWindowCount: number;
    highStressWindows: string[];
    stabilityAverage: number | null;
    yesterdayStabilityAverage: number | null;
    stabilityDelta: number | null;
    stabilityDirection: 'lower' | 'higher' | 'similar' | 'unknown';
    speakingStyle: 'quiet' | 'balanced' | 'talkative';
    dominantEmotion: string;
    customNoticeText?: string;
  } | null;
  practiceReason: string;
  focusChallenge: string | null;
  topTrigger: string | null;
  patterns: { type: string; detail: string }[];
  journeyProgress: { journey_id: string; current_step: number } | null;
  practiceTodos: TodayTodo[];
  monthlyPaths: MonthlyPath[];
  badges: EarnedBadge[];
  pathReviewBanner: PathReviewBanner | null;
}
export interface TodayTodo {
  id: string;
  title: string;
  description: string;
  sourceType: 'manual_schedule' | 'ai_suggestion' | 'path_task';
  sourceLabel: string;
  typeLabel: string;
  status: 'pending' | 'completed';
  completedAt: string | null;
  timeLabel: string | null;
  pathId: string | null;
  pathTitle: string | null;
  actionPrompt: string | null;
}
export interface MonthlyPathTask {
  id: string;
  rawId: number;
  title: string;
  description: string;
  type: string;
  taskDate: string | null;
  status: 'pending' | 'completed';
  completedAt: string | null;
  actionPrompt: string | null;
}
export interface MonthlyPath {
  id: string;
  templateId: string;
  title: string;
  summary: string;
  stressSource: string;
  badgeId: string;
  badgeLabel: string;
  status: 'active' | 'completed';
  icon: string;
  gradient: [string, string];
  completedAt: string | null;
  progress: {
    completed: number;
    total: number;
  };
  nextTask: string | null;
  tasks: MonthlyPathTask[];
}
export interface EarnedBadge {
  badgeId: string;
  earnedAt: string | null;
}
export interface PathReviewBanner {
  id: string;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaPath: string | null;
  relatedPathId: string | null;
  createdAt: string | null;
}
export interface LongitudinalData {
  insights: Insight[];
  triggers: { trigger: string; frequency: number }[];
  patterns: { type: string; detail: string }[];
  dayCount?: number;
}
export interface DayProfile {
  date: string;
  day_of_week: string;
  composite_stress: number | null;
  composite_mood: number | null;
  mood_avg: number | null;
  stress_avg: number | null;
  stress_peak: number | null;
  ambient_stress_avg: number | null;
  ambient_stress_peak: number | null;
  ambient_listening_count: number;
  ambient_transcript_tokens: number;
  practice_count: number;
}
export interface JourneyEnrollment {
  journey_id: string;
  current_step: number;
  started_at: string;
  completed_at: string | null;
}

export interface JourneyMomentOverride {
  t: string;
  app: string;
  note: string;
  s: number;
}

export type AppLanguage = 'zh-CN' | 'en-US';
const GENERIC_TODAY_NOTICE_TEXT = "Ready when you are. What's on your mind today?";

interface AppState {
  // Auth
  token: string | null;
  uid: number | null;
  // Profile
  name: string;
  age: number | null;
  bio: string;
  avatarColor: string;
  challenges: number[];
  sleep: number | null;
  work: number | null;
  onboarded: boolean;
  memoryEnabled: boolean;
  ambientASREnabled: boolean;
  // Voice
  voice: string;
  language: AppLanguage;
  // Gamification
  xp: number;
  streak: number;
  daysUsed: number;
  // Chat
  chatSessionId: string | null;
  temporaryChatEnabled: boolean;
  chat: ChatMsg[];
  // Data
  moods: MoodEntry[];
  journals: JournalEntry[];
  slotsDone: Record<string, boolean>;
  dailyDone: boolean;
  // Paths / Journeys
  activePath: number | null;
  pathStep: number;
  journeyEnrollments: JourneyEnrollment[];
  // Permissions
  perms: Record<string, boolean>;
  // UI
  selDay: number;
  // Remote data (loaded from API)
  paths: PathDef[];
  practices: Record<string, PracticeItem[]>;
  todayFeed: TodayFeed | null;
  longitudinal: LongitudinalData | null;
  history: DayProfile[];
  consumedNoticeIds: string[];
  hiddenJourneyMomentKeys: string[];
  editedJourneyMoments: Record<string, JourneyMomentOverride>;
  ambientListeningEnabled: boolean;
  ambientListeningSupported: boolean;
  ambientListeningActive: boolean;
  ambientListeningTranscript: string;
  ambientListeningInterim: string;
  ambientListeningError: string;
  ambientListeningLastSyncedAt: string | null;
  ambientListeningSessionStartedAt: string | null;
  ambientListeningLastAnalysis: {
    emotion: string;
    stress: number;
    patterns: string[];
    topics: string[];
    tokenCount: number;
  } | null;
  // Actions
  set: (partial: Partial<AppState>) => void;
  setAuth: (token: string, uid: number) => void;
  addXP: (n: number) => void;
  addChat: (msg: ChatMsg) => void;
  replaceChat: (clientId: string, msg: ChatMsg) => void;
  upsertJournal: (entry: JournalEntry) => void;
  clearChat: () => void;
  setChatSessionId: (sessionId: string) => void;
  resetChatSession: () => void;
  markSlot: (key: string) => void;
  togglePerm: (key: string) => void;
  setPaths: (paths: PathDef[]) => void;
  setPractices: (p: Record<string, PracticeItem[]>) => void;
  setTodayFeed: (feed: TodayFeed) => void;
  setLongitudinal: (data: LongitudinalData) => void;
  setHistory: (rows: DayProfile[]) => void;
  markNoticeConsumed: (id: string) => void;
  setJourneyEnrollments: (rows: JourneyEnrollment[]) => void;
  hideJourneyMoment: (key: string) => void;
  showJourneyMoment: (key: string) => void;
  setJourneyMomentEdit: (key: string, value: JourneyMomentOverride) => void;
  clearJourneyMomentEdit: (key: string) => void;
  setAmbientListeningEnabled: (enabled: boolean) => void;
  setAmbientListeningSessionStartedAt: (value: string | null) => void;
  setAmbientListeningState: (partial: Partial<Pick<AppState, 'ambientListeningSupported' | 'ambientListeningActive' | 'ambientListeningTranscript' | 'ambientListeningInterim' | 'ambientListeningError'>>) => void;
  setAmbientListeningSyncResult: (payload: {
    syncedAt: string;
    analysis: NonNullable<AppState['ambientListeningLastAnalysis']>;
  }) => void;
  clearAmbientListeningTranscript: () => void;
  reset: () => void;
}

const INITIAL: Omit<AppState,
  'set' | 'setAuth' | 'addXP' | 'addChat' | 'replaceChat' | 'upsertJournal' | 'clearChat' | 'setChatSessionId' | 'resetChatSession' | 'markSlot' | 'togglePerm' |
  'setPaths' | 'setPractices' | 'setTodayFeed' | 'setLongitudinal' | 'setHistory' | 'setJourneyEnrollments' | 'hideJourneyMoment' | 'showJourneyMoment' | 'setJourneyMomentEdit' | 'clearJourneyMomentEdit' |
  'setTodayFeed' | 'setLongitudinal' | 'setHistory' | 'markNoticeConsumed' | 'setJourneyEnrollments' | 'hideJourneyMoment' | 'showJourneyMoment' | 'setJourneyMomentEdit' | 'clearJourneyMomentEdit' |
  'setAmbientListeningEnabled' | 'setAmbientListeningSessionStartedAt' | 'setAmbientListeningState' | 'setAmbientListeningSyncResult' | 'clearAmbientListeningTranscript' | 'reset'
> = {
  token: null, uid: null,
  name: '', age: null, bio: '', avatarColor: '#8B7FCC',
  challenges: [], sleep: null, work: null, onboarded: false, memoryEnabled: true, ambientASREnabled: true,
  voice: 'classic',
  language: 'zh-CN',
  xp: 0, streak: 0, daysUsed: 0,
  chatSessionId: null,
  temporaryChatEnabled: false,
  chat: [], moods: [], journals: [],
  slotsDone: {}, dailyDone: false,
  activePath: null, pathStep: 0,
  journeyEnrollments: [],
  perms: { mic: false, notifs: false, health: false, calendar: false, location: false },
  selDay: 6,
  paths: [],
  practices: {},
  todayFeed: null,
  longitudinal: null,
  history: [],
  consumedNoticeIds: [],
  hiddenJourneyMomentKeys: [],
  editedJourneyMoments: {},
  ambientListeningEnabled: false,
  ambientListeningSupported: false,
  ambientListeningActive: false,
  ambientListeningTranscript: '',
  ambientListeningInterim: '',
  ambientListeningError: '',
  ambientListeningLastSyncedAt: null,
  ambientListeningSessionStartedAt: null,
  ambientListeningLastAnalysis: null,
};

export function sanitizeChatMessagesForNoticeFlow(chat: ChatMsg[]) {
  if (!Array.isArray(chat)) return [];

  const seenNoticeClientIds = new Set<string>();

  return chat.filter((message) => {
    const clientId = String(message?.clientId || '');
    const content = String(message?.content || '').trim();

    if (clientId.startsWith('assistant_prompt_') || clientId.startsWith('today_noticed_')) {
      return false;
    }

    if (clientId.startsWith('today_notice:') || clientId.startsWith('notice:')) {
      if (content === GENERIC_TODAY_NOTICE_TEXT) {
        return false;
      }
      if (seenNoticeClientIds.has(clientId)) {
        return false;
      }
      seenNoticeClientIds.add(clientId);
    }

    return true;
  });
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      ...INITIAL,
      set: (p) => set(p),
      setAuth: (token, uid) => { set({ token, uid }); setToken(token); },
      addXP: (n) => set((s) => ({ xp: s.xp + n })),
      addChat: (msg) => set((s) => ({ chat: [...s.chat, msg] })),
      replaceChat: (clientId, msg) => set((s) => ({
        chat: s.chat.map((item) => (item.clientId === clientId ? { ...msg } : item)),
      })),
      upsertJournal: (entry) => set((s) => {
        const next = s.journals.filter((item) => item.date !== entry.date);
        return { journals: [entry, ...next].sort((a, b) => String(b.date).localeCompare(String(a.date))) };
      }),
      clearChat: () => set({ chat: [] }),
      setChatSessionId: (chatSessionId) => set({ chatSessionId }),
      resetChatSession: () => set({ chatSessionId: null }),
      markSlot: (k) => set((s) => ({ slotsDone: { ...s.slotsDone, [k]: true } })),
      togglePerm: (k) => set((s) => ({ perms: { ...s.perms, [k]: !s.perms[k] } })),
      setPaths: (paths) => set({ paths }),
      setPractices: (practices) => set({ practices }),
      setTodayFeed: (feed) => set({ todayFeed: feed }),
      setLongitudinal: (data) => set({ longitudinal: data }),
      setHistory: (rows) => set({ history: rows }),
      markNoticeConsumed: (id) => set((s) => ({
        consumedNoticeIds: s.consumedNoticeIds.includes(id)
          ? s.consumedNoticeIds
          : [...s.consumedNoticeIds, id].slice(-50),
      })),
      setJourneyEnrollments: (rows) => set({ journeyEnrollments: rows }),
      hideJourneyMoment: (key) => set((s) => ({
        hiddenJourneyMomentKeys: s.hiddenJourneyMomentKeys.includes(key)
          ? s.hiddenJourneyMomentKeys
          : [...s.hiddenJourneyMomentKeys, key],
      })),
      showJourneyMoment: (key) => set((s) => ({
        hiddenJourneyMomentKeys: s.hiddenJourneyMomentKeys.filter((item) => item !== key),
      })),
      setJourneyMomentEdit: (key, value) => set((s) => ({
        editedJourneyMoments: {
          ...s.editedJourneyMoments,
          [key]: value,
        },
      })),
      clearJourneyMomentEdit: (key) => set((s) => {
        const next = { ...s.editedJourneyMoments };
        delete next[key];
        return { editedJourneyMoments: next };
      }),
      setAmbientListeningEnabled: (enabled) => set({ ambientListeningEnabled: enabled }),
      setAmbientListeningSessionStartedAt: (ambientListeningSessionStartedAt) => set({ ambientListeningSessionStartedAt }),
      setAmbientListeningState: (partial) => set(partial),
      setAmbientListeningSyncResult: ({ syncedAt, analysis }) => set({
        ambientListeningLastSyncedAt: syncedAt,
        ambientListeningLastAnalysis: analysis,
      }),
      clearAmbientListeningTranscript: () => set({
        ambientListeningTranscript: '',
        ambientListeningInterim: '',
        ambientListeningError: '',
        ambientListeningLastSyncedAt: null,
        ambientListeningSessionStartedAt: null,
        ambientListeningLastAnalysis: null,
      }),
      reset: () => { set(INITIAL); setToken(null); },
    }),
    {
      name: 'william-store',
      version: 4,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        const nextState = { ...(persistedState as Record<string, unknown>) };
        nextState.chat = sanitizeChatMessagesForNoticeFlow(Array.isArray(nextState.chat) ? (nextState.chat as ChatMsg[]) : []);
        if (Array.isArray(nextState.consumedNoticeIds)) {
          nextState.consumedNoticeIds = nextState.consumedNoticeIds
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(-50);
        } else {
          const legacyKey = typeof nextState.consumedTodayNoticeKey === 'string'
            ? nextState.consumedTodayNoticeKey.trim()
            : '';
          nextState.consumedNoticeIds = legacyKey ? [legacyKey] : [];
        }
        delete nextState.consumedTodayNoticeKey;
        return nextState;
      },
      onRehydrateStorage: () => (state) => {
        if (state?.token) setToken(state.token);
      },
      partialize: (state) => {
        const {
          paths: _paths,
          practices: _practices,
          ambientListeningEnabled: _ambientListeningEnabled,
          ambientListeningSupported: _ambientListeningSupported,
          ambientListeningActive: _ambientListeningActive,
          ambientListeningTranscript: _ambientListeningTranscript,
          ambientListeningInterim: _ambientListeningInterim,
          ambientListeningError: _ambientListeningError,
          ambientListeningLastSyncedAt: _ambientListeningLastSyncedAt,
          ambientListeningSessionStartedAt: _ambientListeningSessionStartedAt,
          ambientListeningLastAnalysis: _ambientListeningLastAnalysis,
          ...persisted
        } = state;
        return persisted;
      },
    }
  )
);
