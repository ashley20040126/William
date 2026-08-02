import { getJson, postJson, patchJson } from '@/services/http';
import type { ScheduleCandidate } from '@/services/store';

// ── Journey Path definitions ──────────────────────────────────────────────────

export interface PathStep {
  t: string;  // title
  p: string;  // prompt
}

export interface PathDef {
  id: string;
  title: string;
  parts: number;
  icon: string;
  gradient: [string, string];
  steps: PathStep[];
}

// ── Practice definitions ──────────────────────────────────────────────────────

export interface PracticeItem {
  id: string;
  slot: 'morning' | 'midday' | 'evening';
  icon: string;
  name: string;
  desc: string;
  type: string;
  mins: number;
}

// ── Skill Toolkit ────────────────────────────────────────────────────────────

export interface JourneySkill {
  id: string;
  title: string;
  type: string;
  cadence: string;
  trigger: string;
  reason: string;
  steps: string[];
  sourceRange: string;
  lastSeenAt: string;
}

// ── Milestones ───────────────────────────────────────────────────────────────

export interface JourneyMilestone {
  id: string;
  title: string;
  description: string;
  icon: string;
  earned_at: string;
}

// ── Daily Narrative Story ────────────────────────────────────────────────────

export interface StoryPanel {
  type: 'trigger' | 'state' | 'action' | 'resolution';
  title: string;
  text: string;
  signal_source: string;
  image_url?: string;
  image_fallback_reason?: 'missing_api_key' | 'quota_exceeded' | 'request_failed';
}

export interface DailyStory {
  date: string;       // 'YYYY-MM-DD'
  panels: StoryPanel[];
  fromCache: boolean;
}

// ── API functions ────────────────────────────────────────────────────────────

export const getJourneys = () => getJson('/api/journey');

export const getJourneyPaths = () =>
  getJson<PathDef[]>('/api/journey/paths');

export const getJourneyPractices = () =>
  getJson<Record<string, PracticeItem[]>>('/api/journey/practices');

export const enrollJourney = (journeyId: string) =>
  postJson('/api/journey/enroll', { journeyId });

export const advanceJourney = (journeyId: string, step: number, totalSteps: number) =>
  postJson('/api/journey/progress', { journeyId, step, totalSteps });

export const getJourneySkills = () =>
  getJson<JourneySkill[]>('/api/journey/skills');

export const getJourneyMilestones = () =>
  getJson<JourneyMilestone[]>('/api/journey/milestones');

export const getDailyStory = (date: string) =>
  getJson<DailyStory>(`/api/journey/daily-story?date=${encodeURIComponent(date)}`);

export const getRecentStories = (days: number) =>
  getJson<DailyStory[]>(`/api/journey/daily-story?days=${days}`);

// ── Schedule candidates (used by ChatScreen / TodayScreen) ───────────────────

export const getScheduleCandidates = (status = 'candidate', limit = 20) =>
  getJson<ScheduleCandidate[]>(`/api/journey/schedule-candidates?status=${encodeURIComponent(status)}&limit=${limit}`);

export const confirmScheduleCandidate = (candidateId: number) =>
  postJson<ScheduleCandidate>(`/api/journey/schedule-candidates/${candidateId}/confirm`, {});

export const dismissScheduleCandidate = (candidateId: number) =>
  postJson<ScheduleCandidate>(`/api/journey/schedule-candidates/${candidateId}/dismiss`, {});

export const editScheduleCandidate = (
  candidateId: number,
  payload: { title: string; dateText: string; location?: string; notes?: string }
) => patchJson<ScheduleCandidate>(`/api/journey/schedule-candidates/${candidateId}`, payload);
