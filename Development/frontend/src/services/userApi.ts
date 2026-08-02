import { getJson, postForm, postJson, postJsonOrThrow } from '@/services/http';
import type { JournalEntry } from '@/services/store';

export const saveMood = (mood: number, stress: number, note: string) =>
  postJson('/api/user/mood', { mood, stress, note });

type SaveJournalOptions = { stress?: number; mood?: number; date?: string };

type SaveJournalResponse = {
  ok: boolean;
  analysis?: Record<string, unknown>;
  journal: JournalEntry;
};

export const saveJournal = (text: string, options?: SaveJournalOptions) =>
  postJson('/api/user/journal', {
    text: text.slice(0, 5000),
    ...(typeof options?.stress === 'number' ? { stress: options.stress } : {}),
    ...(typeof options?.mood === 'number' ? { mood: options.mood } : {}),
    ...(options?.date ? { date: options.date } : {}),
  });

export const saveJournalOrThrow = (text: string, options?: SaveJournalOptions) =>
  postJsonOrThrow('/api/user/journal', {
    text: text.slice(0, 5000),
    ...(typeof options?.stress === 'number' ? { stress: options.stress } : {}),
    ...(typeof options?.mood === 'number' ? { mood: options.mood } : {}),
    ...(options?.date ? { date: options.date } : {}),
  }) as Promise<SaveJournalResponse>;

export const getJournal = (date?: string) =>
  getJson<JournalEntry | null>(date ? `/api/user/journal?date=${encodeURIComponent(date)}` : '/api/user/journal');

export const uploadJournalAttachments = (files: File[], date?: string) => {
  const form = new FormData();
  files.forEach((file) => form.append('files', file));
  if (date) form.append('date', date);
  return postForm<{ ok: boolean; journal: JournalEntry }>('/api/user/journal/attachments', form);
};

export const saveProfile = (data: Record<string, unknown>) =>
  postJson('/api/user/profile', data);

export const saveProfileOrThrow = (data: Record<string, unknown>) =>
  postJsonOrThrow('/api/user/profile', data);

export const getProfile = () => getJson<Record<string, unknown>>('/api/user/profile');
export const getHistory = (days = 7) => getJson(`/api/user/history?days=${days}`);
export const getInsights = (days = 14) => getJson(`/api/user/insights?days=${days}`);
export const getTodayFeed = (date?: string) =>
  getJson(date ? `/api/user/today?date=${encodeURIComponent(date)}` : '/api/user/today');
export const logPractice = (todoId: string, completed = true) =>
  postJson('/api/user/practices', { todoId, completed });

export const confirmAssistantPracticeSuggestion = (payload: {
  title: string;
  description: string;
  recommendedTime?: string | null;
  actionPrompt?: string | null;
  suggestionDate?: string | null;
}) => postJson('/api/user/practice-suggestions/confirm', payload);

export type UserMemory = {
  id: number;
  scope: string;
  memoryType: string;
  content: string;
  confidence: number;
  status: string;
  timesSeen: number;
  updatedAt?: string | null;
};

export type UserActiveLoop = {
  id: number;
  loopType: string;
  title: string;
  summary: string;
  confidence: number;
  status: string;
  timesSeen: number;
  dueHint?: string;
  updatedAt?: string | null;
};

export type UserInterventionPreference = {
  interventionType: string;
  evidenceCount: number;
  positiveCount: number;
  negativeCount: number;
  acceptanceCount: number;
  followthroughCount: number;
  avgOutcomeScore: number;
  effectivenessLabel: 'helpful' | 'mixed' | 'avoid' | 'unknown';
  summary: string;
  updatedAt?: string | null;
};

export type UserInterventionOutcome = {
  id: number;
  interventionType: string;
  suggestionSummary: string;
  acceptedSignal: string;
  followupSignal: string;
  outcomeScore: number;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export const getMemories = (limit = 30) =>
  getJson<{
    enabled: boolean;
    memories: UserMemory[];
    activeLoops: UserActiveLoop[];
    interventionOverview: {
      preferences: UserInterventionPreference[];
      topHelpful: UserInterventionPreference[];
      avoid: UserInterventionPreference[];
      recentOutcomes: UserInterventionOutcome[];
    };
  }>(`/api/user/memories?limit=${limit}`);

export const updateMemoryStatus = (memoryId: number, status: 'active' | 'suppressed' | 'deleted') =>
  postJsonOrThrow(`/api/user/memories/${memoryId}/status`, { status });

export const updateActiveLoopStatus = (loopId: number, status: 'active' | 'resolved' | 'dismissed') =>
  postJsonOrThrow(`/api/user/active-loops/${loopId}/status`, { status });
