import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '@/services/store';
import * as api from '@/services/api';
import type { DayProfile, ScheduleCandidate, TodayTodo } from '@/services/store';
import { MOOD_EMOJI } from '@/utils/data';
import { getDisplayStress, hasAmbientSignal, toNumber } from '@/utils/wellbeing';
import { Card, SectionLabel } from '@/components/ui';
import JourneyMomentEditor, { type JourneyMomentEditorPayload } from '@/components/JourneyMomentEditor';
import TodayCalendarPicker from '@/components/TodayCalendarPicker';
import TodayNoticeCard from '@/components/TodayNoticeCard';
import { haptic } from '@/hooks/useWebViewBridge';
import { useI18n } from '@/i18n/useI18n';
import { getIntlLocale, translateText } from '@/i18n/messages';
import { resolveTodayNotice } from '@/utils/notices';

export default function TodayScreen() {
  const MONTH_LOAD_STEP = 2;
  const s = useStore();
  const nav = useNavigate();
  const { tx, locale } = useI18n();
  const today = startOfDay(new Date());
  const maxSelectableDate = startOfDay(addDays(today, 30));
  const journalFileInputRef = useRef<HTMLInputElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollAdjustRef = useRef<{ previousWidth: number; previousLeft: number } | null>(null);
  const [registrationDate, setRegistrationDate] = useState<Date>(today);
  const [selectedFeed, setSelectedFeed] = useState<ReturnType<typeof useStore.getState>['todayFeed']>(null);
  const [scheduleCandidates, setScheduleCandidates] = useState<ScheduleCandidate[]>([]);
  const [confirmedScheduleCandidates, setConfirmedScheduleCandidates] = useState<ScheduleCandidate[]>([]);
  const [scheduleBusyId, setScheduleBusyId] = useState<number | null>(null);
  const [deletingMomentKey, setDeletingMomentKey] = useState<string | null>(null);
  const [editingMoment, setEditingMoment] = useState<JourneyMomentEditorPayload | null>(null);
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(today));
  const [selectedDateKey, setSelectedDateKey] = useState(() => formatDateKey(today));
  const [loadedMonthRange, setLoadedMonthRange] = useState({ start: 0, end: 0 });
  const [todoBusyId, setTodoBusyId] = useState<string | null>(null);
  const [showAllPractices, setShowAllPractices] = useState(false);
  const historyByDate = new Map(s.history.map((row) => [String(row.date), row]));
  const selectedDate = parseDateKey(selectedDateKey) || today;
  const monthTimeline = useMemo(() => getMonthTimeline(registrationDate, maxSelectableDate), [maxSelectableDate, registrationDate]);
  const selectedMonthKey = formatMonthKey(selectedDate);
  const selectedMonthIndex = Math.max(0, monthTimeline.findIndex((month) => month.key === selectedMonthKey));
  const timelineDays = useMemo(() => {
    const startIndex = Math.max(0, Math.min(loadedMonthRange.start, monthTimeline.length - 1));
    const endIndex = Math.max(startIndex, Math.min(loadedMonthRange.end, monthTimeline.length - 1));
    const visibleMonths = monthTimeline.slice(startIndex, endIndex + 1);
    const days = [];
    for (const month of visibleMonths) {
      for (let cursor = startOfDay(month.start); cursor <= month.end; cursor = addDays(cursor, 1)) {
        const d = new Date(cursor);
        const key = formatDateKey(d);
        const hist = historyByDate.get(key);
        let emoIdx: number | null = null;
        if (hist && (hist.composite_mood != null || hist.mood_avg != null)) {
          emoIdx = Math.min(4, Math.max(0, Math.round((1 - toNumber(hist.composite_mood ?? hist.mood_avg, 3) / 5) * 4)));
        }
        days.push({
          key,
          monthKey: month.key,
          monthLabel: month.label,
          isMonthStart: key === formatDateKey(month.start),
          dateNum: String(d.getDate()),
          dayLabel: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d),
          moodEmoji: emoIdx !== null ? (MOOD_EMOJI[emoIdx] ?? null) : null,
        });
      }
    }
    return days;
  }, [historyByDate, loadedMonthRange.end, loadedMonthRange.start, locale, monthTimeline]);
  const selectedHistory = historyByDate.get(selectedDateKey);
  const day = buildSelectedDayData({
    date: selectedDate,
    profile: selectedHistory,
  });
  const confirmedScheduleEvents: JourneyMomentEvent[] = confirmedScheduleCandidates
    .filter((candidate) => {
      const dateKey = getCandidateDateKey(candidate);
      if (!dateKey) return selectedDateKey === formatDateKey(today);
      return dateKey === selectedDateKey;
    })
    .map(toScheduleMomentEvent);
  const baseEvents = ((day.events || []) as JourneyMomentEvent[]).map((event) => {
    const key = event.key || buildDefaultMomentKey(selectedDateKey, event);
    const override = s.editedJourneyMoments[key];
    return {
      ...event,
      ...(override || {}),
      key,
      source: event.source || 'default',
    };
  });
  const dayEvents: JourneyMomentEvent[] = [...baseEvents, ...confirmedScheduleEvents]
    .filter((event) => !s.hiddenJourneyMomentKeys.includes(event.key || buildDefaultMomentKey(selectedDateKey, event)))
    .sort(compareMomentEventTime);
  const peak = dayEvents.length > 0 ? dayEvents.reduce((a, b) => (a.s > b.s ? a : b), dayEvents[0]) : null;
  const peakStress = peak?.s ?? (day.avgS ? Math.round(day.avgS) : 0);
  const isTodaySelected = selectedDateKey === formatDateKey(today);
  const selectedDateLabel = formatSelectedDateLabel(selectedDateKey, isTodaySelected);
  const dayHasAmbient = hasAmbientSignal(selectedHistory);
  const selectedJournal = s.journals.find((entry) => entry.date === selectedDateKey) || null;
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalUploadError, setJournalUploadError] = useState<string | null>(null);
  const [journalUploading, setJournalUploading] = useState(false);
  const todayDateKey = formatDateKey(today);
  const activeFeed = selectedFeed || s.todayFeed;
  const visibleScheduleCandidates = scheduleCandidates.filter((candidate) => {
    const candidateDateKey = getCandidateDateKey(candidate);
    if (!candidateDateKey) return isTodaySelected;
    return candidateDateKey === selectedDateKey;
  });
  const practiceTodos = (activeFeed?.practiceTodos || []).filter((todo) => todo.sourceType !== 'manual_schedule');
  const pendingPracticeTodos = practiceTodos.filter((todo) => todo.status !== 'completed');
  const completedPracticeCount = practiceTodos.length - pendingPracticeTodos.length;
  const monthlyPaths = activeFeed?.monthlyPaths || [];
  const pathReviewBanner = isTodaySelected ? (activeFeed?.pathReviewBanner || null) : null;
  const voiceInsight = activeFeed?.voiceInsight || null;
  const ambientListeningEnabled = s.ambientListeningEnabled;
  const ambientListeningSupported = s.ambientListeningSupported;
  const ambientListeningActive = s.ambientListeningActive;
  const ambientListeningError = s.ambientListeningError;
  const ambientListeningLastSyncedAt = s.ambientListeningLastSyncedAt;
  const ambientListeningSessionStartedAt = s.ambientListeningSessionStartedAt;

  function refreshTodayFeed(targetDateKey = selectedDateKey) {
    return api.getTodayFeed(targetDateKey).then((feed) => {
      if (feed) {
        setSelectedFeed(feed as ReturnType<typeof s.setTodayFeed> extends void ? never : Parameters<typeof s.setTodayFeed>[0]);
        if (targetDateKey === todayDateKey) {
          s.setTodayFeed(feed as ReturnType<typeof s.setTodayFeed> extends void ? never : Parameters<typeof s.setTodayFeed>[0]);
        }
      }
      return feed;
    });
  }

  // Load today feed + longitudinal insights on mount
  useEffect(() => {
    if (!s.token) return;
    api.getProfile().then((profile) => {
      const createdAt = typeof profile?.created_at === 'string' ? profile.created_at : null;
      const registeredAt = createdAt ? new Date(createdAt) : today;
      const startDate = Number.isNaN(registeredAt.getTime()) ? today : startOfDay(registeredAt);
      setRegistrationDate(startDate);
      const daysSinceSignup = Math.max(1, differenceInCalendarDays(today, startDate) + 1);
      api.getHistory(daysSinceSignup).then((data) => {
        if (data) s.setHistory(data as Parameters<typeof s.setHistory>[0]);
      });
    });
    refreshTodayFeed(todayDateKey);
    api.getInsights(14).then((data) => {
      if (data) s.setLongitudinal(data as Parameters<typeof s.setLongitudinal>[0]);
    });
    api.getScheduleCandidates('candidate', 8).then((data) => {
      if (data) setScheduleCandidates(data);
    });
    api.getScheduleCandidates('confirmed', 12).then((data) => {
      if (data) setConfirmedScheduleCandidates(data);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.token]);

  useEffect(() => {
    if (!s.token) return;
    void refreshTodayFeed(selectedDateKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDateKey, s.token]);

  useEffect(() => {
    if (monthTimeline.length === 0) return;
    setLoadedMonthRange((current) => {
      const safeStart = Math.max(0, Math.min(current.start, monthTimeline.length - 1));
      const safeEnd = Math.max(safeStart, Math.min(current.end, monthTimeline.length - 1));
      const nextStart = Math.max(0, selectedMonthIndex - 1);
      const nextEnd = Math.min(monthTimeline.length - 1, selectedMonthIndex + 1);
      if (current.start === 0 && current.end === 0 && monthTimeline.length > 1) {
        return { start: nextStart, end: nextEnd };
      }
      if (selectedMonthIndex < safeStart || selectedMonthIndex > safeEnd) {
        return { start: nextStart, end: nextEnd };
      }
      if (safeStart !== current.start || safeEnd !== current.end) {
        return { start: safeStart, end: safeEnd };
      }
      return current;
    });
  }, [monthTimeline, selectedMonthIndex]);

  useEffect(() => {
    const timeline = timelineScrollRef.current;
    const pending = pendingScrollAdjustRef.current;
    if (!timeline || !pending) return;
    pendingScrollAdjustRef.current = null;
    const widthDelta = timeline.scrollWidth - pending.previousWidth;
    timeline.scrollLeft = pending.previousLeft + Math.max(0, widthDelta);
  }, [timelineDays]);

  useEffect(() => {
    const timeline = timelineScrollRef.current;
    if (!timeline) return;
    const selectedButton = timeline.querySelector<HTMLElement>(`[data-date-key="${selectedDateKey}"]`);
    selectedButton?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selectedDateKey, timelineDays]);

  useEffect(() => {
    if (!s.token) return;
    let active = true;
    setJournalLoading(true);
    api.getJournal(selectedDateKey).then((entry) => {
      if (!active) return;
      if (entry) {
        useStore.getState().upsertJournal(entry);
      }
      if (selectedDateKey === todayDateKey) {
        useStore.getState().set({ dailyDone: Boolean(entry) });
      }
    }).finally(() => {
      if (active) setJournalLoading(false);
    });

    return () => {
      active = false;
    };
  }, [s.token, selectedDateKey, todayDateKey]);

  useEffect(() => {
    if (!s.token || !isTodaySelected || !ambientListeningLastSyncedAt) return;
    void refreshTodayFeed(todayDateKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambientListeningLastSyncedAt, isTodaySelected, s.token]);

  // "William noticed" should only exist for a real proactive signal, not a generic fallback line.
  const insight = s.todayFeed?.insight ?? null;
  const todayNotice = isTodaySelected
    ? resolveTodayNotice({
        dateKey: todayDateKey,
        voiceInsight,
        insight,
        dayHasAmbient,
        ambientStressAvg: selectedHistory?.ambient_stress_avg ?? null,
        topTrigger: s.todayFeed?.topTrigger || null,
        tx,
      })
    : null;
  const noticedText = isTodaySelected
    ? (todayNotice?.text || '')
    : buildHistoricalNotice({
        dateLabel: selectedDateLabel,
        dayLabel: day.day,
        avgStress: day.avgS,
        peakStress,
        peakEvent: peak,
        momentCount: dayEvents.length,
      });

  async function handleScheduleAction(candidateId: number, action: 'confirm' | 'dismiss') {
    setScheduleBusyId(candidateId);
    const next = action === 'confirm'
      ? await api.confirmScheduleCandidate(candidateId)
      : await api.dismissScheduleCandidate(candidateId);
    setScheduleBusyId(null);
    if (!next) return;
    setScheduleCandidates((current) => current.filter((candidate) => candidate.id !== candidateId));
    if (action === 'confirm') {
      setConfirmedScheduleCandidates((current) => [next, ...current.filter((candidate) => candidate.id !== candidateId)]);
    }
    haptic(action === 'confirm' ? 'medium' : 'light');
  }

  async function handleSaveMoment(payload: JourneyMomentEditorPayload) {
    if (payload.type === 'schedule') {
      setScheduleBusyId(payload.candidate.id);
      const next = await api.editScheduleCandidate(payload.candidate.id, {
        title: payload.title,
        dateText: payload.dateText,
        location: payload.location,
        notes: payload.notes,
      });
      setScheduleBusyId(null);
      if (!next) return;
      setScheduleCandidates((current) =>
        current.map((candidate) => (candidate.id === next.id ? next : candidate))
      );
      setConfirmedScheduleCandidates((current) =>
        current.map((candidate) => (candidate.id === next.id ? next : candidate))
      );
      setEditingMoment(null);
      haptic('light');
      return;
    }

    s.setJourneyMomentEdit(payload.key, {
      t: payload.time,
      app: payload.place,
      note: payload.event,
      s: Math.max(0, Math.min(10, payload.stress)),
    });
    s.showJourneyMoment(payload.key);
    setEditingMoment(null);
    haptic('light');
  }

  async function handleDeleteMoment(payload: JourneyMomentEditorPayload) {
    if (payload.type === 'schedule') {
      setDeletingMomentKey(`schedule:${payload.candidate.id}`);
      const next = await api.dismissScheduleCandidate(payload.candidate.id);
      setDeletingMomentKey(null);
      if (!next) return;
      setScheduleCandidates((current) => current.filter((candidate) => candidate.id !== payload.candidate.id));
      setConfirmedScheduleCandidates((current) => current.filter((candidate) => candidate.id !== payload.candidate.id));
      setEditingMoment(null);
      haptic('light');
      return;
    }

    s.hideJourneyMoment(payload.key);
    setEditingMoment(null);
    haptic('light');
  }

  function openMomentEditor(event: JourneyMomentEvent) {
    if (event.source === 'schedule' && event.candidate) {
      setEditingMoment({
        type: 'schedule',
        candidate: event.candidate,
        title: event.candidate.title,
        dateText: event.candidate.dateText || event.candidate.startTime || '',
        location: event.candidate.location,
        notes: readCandidateNotes(event.candidate),
      });
      return;
    }

    setEditingMoment({
      type: 'default',
      key: event.key || buildDefaultMomentKey(selectedDateKey, event),
      time: event.t,
      place: event.app,
      event: event.note,
      stress: event.s,
    });
  }

  function openCalendarPicker() {
    setVisibleMonth(startOfMonth(selectedDate));
    setShowCalendarPicker(true);
  }

  function handleCalendarPick(nextDate: Date) {
    setSelectedDateKey(formatDateKey(nextDate));
    setVisibleMonth(startOfMonth(nextDate));
    setShowCalendarPicker(false);
    haptic('light');
  }

  async function toggleTodo(todo: TodayTodo) {
    if (todoBusyId) return;
    setTodoBusyId(todo.id);
    await api.logPractice(todo.id, todo.status !== 'completed');
    await refreshTodayFeed();
    setTodoBusyId(null);
    haptic('light');
  }

  async function handleJournalAttachmentUpload(files: FileList | null) {
    const nextFiles = files ? Array.from(files).filter(Boolean) : [];
    if (nextFiles.length === 0 || journalUploading) return;
    setJournalUploadError(null);
    setJournalUploading(true);
    try {
      const response = await api.uploadJournalAttachments(nextFiles, selectedDateKey);
      if (response?.journal) {
        s.upsertJournal(response.journal);
      }
      haptic('light');
    } catch (error) {
      setJournalUploadError(error instanceof Error ? error.message : tx('Failed to upload attachment'));
    } finally {
      setJournalUploading(false);
      if (journalFileInputRef.current) {
        journalFileInputRef.current.value = '';
      }
    }
  }

  function handleMonthChange(nextMonth: Date) {
    setVisibleMonth(clampMonth(startOfMonth(nextMonth), registrationDate, maxSelectableDate));
  }

  function shiftSelectedMonth(step: number) {
    const nextIndex = Math.max(0, Math.min(monthTimeline.length - 1, selectedMonthIndex + step));
    const nextMonth = monthTimeline[nextIndex];
    if (!nextMonth) return;
    const nextDate = clampDate(selectedDate, nextMonth.start, nextMonth.end);
    handleCalendarPick(nextDate);
  }

  function handleTimelineScroll() {
    const timeline = timelineScrollRef.current;
    if (!timeline || monthTimeline.length === 0) return;

    if (timeline.scrollLeft < 120 && loadedMonthRange.start > 0) {
      pendingScrollAdjustRef.current = {
        previousWidth: timeline.scrollWidth,
        previousLeft: timeline.scrollLeft,
      };
      setLoadedMonthRange((current) => ({
        start: Math.max(0, current.start - MONTH_LOAD_STEP),
        end: current.end,
      }));
      return;
    }

    const remainingRight = timeline.scrollWidth - timeline.clientWidth - timeline.scrollLeft;
    if (remainingRight < 120 && loadedMonthRange.end < monthTimeline.length - 1) {
      setLoadedMonthRange((current) => ({
        start: current.start,
        end: Math.min(monthTimeline.length - 1, current.end + MONTH_LOAD_STEP),
      }));
    }
  }

  async function toggleAmbientListening() {
    if (!ambientListeningSupported && !ambientListeningEnabled) return;
    const nextEnabled = !ambientListeningEnabled;
    if (nextEnabled) {
      s.setAmbientListeningSessionStartedAt(new Date().toISOString());
      s.setAmbientListeningEnabled(true);
      haptic('light');
      return;
    }

    s.setAmbientListeningEnabled(false);
    const finalized = ambientListeningSessionStartedAt
      ? await api.finalizeAmbientListeningSession(ambientListeningSessionStartedAt, {
          sourceSessionKey: s.chatSessionId || '',
        })
      : null;
    s.setAmbientListeningSessionStartedAt(null);
    s.clearAmbientListeningTranscript();
    if (finalized?.ok) {
      await refreshTodayFeed(todayDateKey);
      const [candidateRows, confirmedRows] = await Promise.all([
        api.getScheduleCandidates('candidate', 8),
        api.getScheduleCandidates('confirmed', 12),
      ]);
      if (candidateRows) setScheduleCandidates(candidateRows);
      if (confirmedRows) setConfirmedScheduleCandidates(confirmedRows);
    }
    haptic('light');
  }

  const noticeBadgeTone = todayNotice?.source === 'voice'
    ? (todayNotice.severity || 'neutral')
    : insight?.type || 'neutral';
  const noticeBadgeLabel = todayNotice?.source === 'voice'
    ? 'AI VOICE'
    : isTodaySelected && insight
      ? (insight.type === 'warning' ? '⚠ HIGH' : '✓ GOOD')
      : null;

  return (
    <>
    <div className="h-full overflow-y-auto scroll-area" style={{ paddingTop: 'max(env(safe-area-inset-top,8px), 8px)' }}>

      <div className="px-4 pt-2 pb-2">
          <button
            type="button"
            onClick={openCalendarPicker}
            className="w-full px-4 py-3 rounded-[24px] bg-bg-2 text-[13px] font-semibold text-ink border-none cursor-pointer flex items-center justify-center"
          >
            <span>{formatSelectedDateButton(selectedDate, locale, isTodaySelected)}</span>
            <span className="ml-2 text-[11px] text-ink-4">▼</span>
          </button>
      </div>

      <div className="px-4 pb-6 space-y-3 mt-2">
        {isTodaySelected && (
          <button
            type="button"
            onClick={toggleAmbientListening}
            className="w-full text-left rounded-[22px] border border-[rgba(80,70,160,0.1)] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.98),rgba(245,241,255,0.94))] shadow-card px-4 py-4"
          >
            <div className="flex items-center gap-3">
              <div className="relative w-12 h-12 rounded-full bg-[rgba(36,31,62,0.96)] flex items-center justify-center flex-shrink-0 shadow-[0_0_0_8px_rgba(155,143,208,0.08)]">
                <span className={`absolute inset-0 rounded-full ${ambientListeningEnabled ? 'animate-pulse bg-[rgba(155,143,208,0.16)]' : 'bg-transparent'}`} />
                <span className="relative text-[20px] text-white">🎙️</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-warm">{tx('Companion sensing')}</p>
                <p className="text-[15px] font-bold text-ink mt-0.5">
                  {ambientListeningEnabled ? tx('Listening…') : tx('Let William listen quietly in the background')}
                </p>
                <p className="text-[12px] text-ink-3 leading-relaxed mt-1">
                  {tx('This is not eavesdropping. It is companion sensing. Every 5 seconds William samples the room and looks for stress, fatigue, and conversational load.')}
                </p>
                <p className="text-[11px] text-ink-4 mt-2">
                  {ambientListeningEnabled
                    ? (ambientListeningActive ? tx('后台监听中，可继续使用其他页面') : tx('正在恢复监听…'))
                    : ambientListeningSupported
                      ? tx('Tap to enable long background listening on Today.')
                      : tx('当前浏览器暂不支持')}
                </p>
                {ambientListeningError && (
                  <p className="text-[11px] text-rose mt-1">{ambientListeningError}</p>
                )}
              </div>
              <div className={`w-11 h-6 rounded-full flex items-center px-1 transition-colors ${ambientListeningEnabled ? 'bg-teal/25 justify-end' : 'bg-[rgba(80,70,160,0.12)] justify-start'}`}>
                <div className={`w-4 h-4 rounded-full transition-colors ${ambientListeningEnabled ? 'bg-teal' : 'bg-white shadow-[0_2px_4px_rgba(23,18,46,0.12)]'}`} />
              </div>
            </div>
          </button>
        )}

        {isTodaySelected && pathReviewBanner && (
          <button
            type="button"
            onClick={() => nav(pathReviewBanner.ctaPath || (pathReviewBanner.relatedPathId ? `/path/${pathReviewBanner.relatedPathId}` : '/journey'))}
            className="w-full text-left p-4 rounded-[18px] border-none cursor-pointer shadow-card"
            style={{ background: 'linear-gradient(135deg, rgba(28,24,48,0.96), rgba(86,68,150,0.92))' }}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-[14px] bg-[rgba(255,255,255,0.12)] flex items-center justify-center flex-shrink-0 text-[20px]">
                🧭
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[rgba(236,234,246,0.58)]">
                  {tx('New AI path')}
                </p>
                <p className="text-[15px] font-bold text-white leading-snug mt-1">
                  {tx(pathReviewBanner.title)}
                </p>
                <p className="text-[12px] text-[rgba(236,234,246,0.76)] leading-relaxed mt-1.5">
                  {tx(pathReviewBanner.body)}
                </p>
                <p className="text-[11px] font-semibold text-warm mt-3">
                  {tx(pathReviewBanner.ctaLabel || 'Open new path')}
                </p>
              </div>
              <span className="text-[rgba(236,234,246,0.5)] text-lg flex-shrink-0">→</span>
            </div>
          </button>
        )}

        {/* ── William noticed ── */}
        <TodayNoticeCard
          noticedText={noticedText}
          badgeTone={noticeBadgeTone}
          badgeLabel={noticeBadgeLabel}
          isTodaySelected={isTodaySelected}
          selectedDateLabel={selectedDateLabel}
          onClick={() => nav('/chat', {
            state: {
              assistantPrompt: noticedText,
              source: 'today_noticed',
              nonce: Date.now(),
            },
          })}
        />

        {visibleScheduleCandidates.length > 0 && (
          <Card className="p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <SectionLabel>{tx('Planned From William')}</SectionLabel>
                <p className="text-[15px] font-bold text-ink">{tx('Detected from recent chat')}</p>
              </div>
              <span className="text-[11px] font-semibold text-ink-4">
                {visibleScheduleCandidates.length} {tx('pending')}
              </span>
            </div>
            <div className="space-y-2.5">
              {visibleScheduleCandidates.map((candidate) => (
                <div key={candidate.id} className="rounded-2xl border border-[rgba(80,70,160,0.1)] bg-white px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink leading-snug">{candidate.title}</p>
                      <p className="text-[11px] text-ink-4 mt-1">
                        {formatSchedulePrimary(candidate)}
                      </p>
                      {(candidate.location || candidate.participants.length > 0) && (
                        <p className="text-[11px] text-ink-4 mt-1">
                          {[candidate.location, candidate.participants.join(' · ')].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {readCandidateNotes(candidate) && (
                        <p className="text-[11px] text-ink-3 mt-1 line-clamp-2">
                          {tx('Notes')}: {readCandidateNotes(candidate)}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-bg-2 text-ink-3">
                      {Math.round(candidate.confidence * 100)}%
                    </span>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleScheduleAction(candidate.id, 'confirm')}
                      disabled={scheduleBusyId === candidate.id}
                      className="flex-1 bg-ink text-bg text-[11px] font-bold px-3 py-2 rounded-xl border-none disabled:opacity-50"
                    >
                      {tx('Add to Journey')}
                    </button>
                    <button
                      onClick={() => setEditingMoment({
                        type: 'schedule',
                        candidate,
                        title: candidate.title,
                        dateText: candidate.dateText || candidate.startTime || '',
                        location: candidate.location,
                        notes: readCandidateNotes(candidate),
                      })}
                      disabled={scheduleBusyId === candidate.id}
                      className="px-3 py-2 rounded-xl text-[11px] font-bold bg-white text-ink-3 border border-[rgba(80,70,160,0.08)] disabled:opacity-50"
                    >
                      {tx('Edit')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-4">
          <div className="flex items-end justify-between gap-3 mb-3">
            <div>
              <p className="text-[15px] font-bold text-ink">{tx('Schedule')}</p>
            </div>
          </div>

          {dayEvents.length === 0 ? (
            <p className="text-[13px] text-ink-3 leading-relaxed">
              {tx('{dateLabel} ({dayLabel}) doesn’t have any saved moments yet. You can still add plans here or use William to reflect on that day.', {
                dateLabel: selectedDateLabel,
                dayLabel: day.day,
              })}
            </p>
          ) : (
            <div className="border-t border-[rgba(80,70,160,0.1)] pt-3">
              {dayEvents.map((event, index) => {
                const tone = getMomentTone(event.s);
                const rowKey = event.key || buildDefaultMomentKey(selectedDateKey, event);
                return (
                  <div
                    key={rowKey}
                    className={`flex items-center gap-2 py-2 ${index !== dayEvents.length - 1 ? 'border-b border-[rgba(28,24,48,0.04)]' : ''}`}
                  >
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tone.dot }} />
                    <div className="min-w-[42px] text-[11px] font-semibold text-ink-4 flex-shrink-0">{event.t}</div>
                    <div className="flex-1 min-w-0 text-[12px] font-semibold text-ink truncate">
                      {tx(event.app)} {' — '} {tx(event.note)}
                    </div>
                    <button
                      type="button"
                      onClick={() => openMomentEditor(event)}
                      className="flex-shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-full border border-[rgba(80,70,160,0.12)] bg-white text-ink-3"
                    >
                      {tx('Edit')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ── Today's practices ── */}
        <div className="bg-white rounded-[18px] border border-[rgba(80,70,160,0.1)] shadow-card px-4">
          <div className="flex items-center justify-between pt-4 pb-1">
            <p className="text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em]">{tx("Today's practices")}</p>
            {practiceTodos.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAllPractices(true)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-warm border-none bg-transparent"
              >
                {completedPracticeCount > 0 && (
                  <span className="bg-teal/10 text-teal text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {completedPracticeCount} ✓
                  </span>
                )}
                {tx('View all')}
              </button>
            )}
          </div>
          {pendingPracticeTodos.length === 0 ? (
            <div className="py-4 pb-5">
              <p className="text-[13px] font-semibold text-ink">
                {completedPracticeCount > 0
                  ? tx('All practices completed!')
                  : tx('No pending practices right now.')}
              </p>
              <p className="text-[11px] text-ink-3 mt-1 leading-relaxed">
                {completedPracticeCount > 0
                  ? tx('{n} completed today · tap View all to review', { n: completedPracticeCount })
                  : isTodaySelected
                  ? tx('As your schedule and recovery signals update, William will place new items here.')
                  : tx('No tasks are scheduled for this date yet.')}
              </p>
            </div>
          ) : (
            <div className="pb-4">
              {pendingPracticeTodos.map((todo, index) => {
                const isLast = index === pendingPracticeTodos.length - 1;
                const sourceTone = getPracticeSourceTone(todo.sourceType);
                return (
                  <div
                    key={todo.id}
                    className={`py-3.5 ${!isLast ? 'border-b border-[rgba(80,70,160,0.08)]' : ''}`}
                  >
                    <div className={`flex items-start gap-3 rounded-[18px] px-3.5 py-3 border ${sourceTone.container}`}>
                      <button
                        type="button"
                        disabled={todoBusyId === todo.id}
                        onClick={() => toggleTodo(todo)}
                        className="mt-0.5 w-6 h-6 rounded-full border flex items-center justify-center text-[12px] transition-all disabled:opacity-40 bg-white border-[rgba(80,70,160,0.22)] text-transparent"
                      >
                        ✓
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[13px] font-bold leading-snug text-ink">{tx(todo.title)}</p>
                          {todo.timeLabel && (
                            <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-bg-2 text-ink-4">{todo.timeLabel}</span>
                          )}
                        </div>
                        <p className="text-[11px] text-ink-3 mt-1 leading-relaxed">
                          {todo.sourceType === 'manual_schedule' && todo.description.startsWith('Planned event · ')
                            ? tx('Planned event · {location}', { location: todo.description.slice('Planned event · '.length) })
                            : tx(todo.description)}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap mt-2">
                          <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${sourceTone.sourceChip}`}>{tx(todo.sourceLabel)}</span>
                          <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[rgba(196,82,122,0.08)] text-warm">{tx(todo.typeLabel)}</span>
                          {todo.pathTitle && (
                            <button
                              type="button"
                              onClick={() => nav(`/path/${todo.pathId}`)}
                              className={`text-[10px] font-semibold px-2 py-1 rounded-full border-none cursor-pointer ${sourceTone.pathChip}`}
                            >
                              {tx(todo.pathTitle)}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Journal */}
        <Card className="p-4">
          <div className="flex gap-3">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${selectedJournal ? 'bg-teal-light' : 'bg-warm-light'}`}>
              <span className="text-[22px]">{selectedJournal ? '✅' : '📓'}</span>
            </div>
            <div className="flex-1">
              <SectionLabel>{tx('Daily Journal')}</SectionLabel>
              <p className="text-[15px] font-bold text-ink">{selectedJournal ? tx('Continue writing') : tx('Write your thoughts')}</p>
              <p className="text-xs text-ink-3 leading-relaxed">
                {selectedJournal
                  ? buildJournalPreview(selectedJournal.text, tx('You can reopen and update this entry anytime.'))
                  : tx('William will analyze your journal.')}
              </p>
            </div>
            {!selectedJournal && <span className="text-xs font-bold text-warm">+25</span>}
          </div>
          <button
            onClick={() => nav(`/mood?date=${selectedDateKey}`)}
            disabled={journalLoading}
            className="w-full mt-3 bg-ink text-bg py-2.5 rounded-xl text-[13px] font-bold cursor-pointer border-none flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <span>{selectedJournal ? '📝' : '✍️'}</span> {tx(selectedJournal ? 'Edit journal entry' : 'Write journal entry')}
          </button>
          <button
            type="button"
            onClick={() => journalFileInputRef.current?.click()}
            disabled={journalUploading}
            className="w-full mt-2 bg-white text-ink py-2.5 rounded-xl text-[13px] font-bold cursor-pointer border border-[rgba(80,70,160,0.12)] flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <span>{journalUploading ? '⏳' : '📎'}</span> {tx(journalUploading ? 'Uploading attachments…' : 'Upload attachments')}
          </button>
          <input
            ref={journalFileInputRef}
            type="file"
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.md,.csv"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleJournalAttachmentUpload(event.target.files);
            }}
          />
          {journalUploadError && (
            <p className="text-[11px] text-rose mt-2">{journalUploadError}</p>
          )}
          {selectedJournal?.attachments && selectedJournal.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedJournal.attachments.map((attachment) => (
                <a
                  key={`${attachment.id || attachment.path}-${attachment.name}`}
                  href={api.resolveAssetUrl(attachment.path)}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-full inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-2 text-[11px] text-ink-3 no-underline"
                >
                  <span>{attachment.kind === 'image' ? '🖼️' : attachment.kind === 'video' ? '🎬' : attachment.kind === 'audio' ? '🎧' : '📄'}</span>
                  <span className="truncate max-w-[180px]">{attachment.name}</span>
                </a>
              ))}
            </div>
          )}
        </Card>

        <div>
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em]">{tx('Paths for you')}</p>
            <button
              className="text-[11px] text-warm font-semibold border-none bg-transparent cursor-pointer"
              onClick={() => nav('/journey')}
            >
              {tx('See all →')}
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 pb-2">
            {monthlyPaths.slice(0, 5).map((path) => (
              <button
                key={path.id}
                className="flex-shrink-0 w-[190px] h-[132px] rounded-[20px] overflow-hidden relative cursor-pointer border-none text-left shadow-elevated"
                style={{ background: `linear-gradient(135deg, ${path.gradient[0]}, ${path.gradient[1]})` }}
                onClick={() => nav(`/path/${path.id}`)}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[22px] mb-1">{path.icon}</p>
                    <span className="text-[9px] font-semibold px-2 py-1 rounded-full bg-white/18 text-white/90">
                      {path.progress.completed}/{path.progress.total}
                    </span>
                  </div>
                  <p className="text-[12px] font-bold text-white leading-snug">{tx(path.title)}</p>
                  <p className="text-[10px] text-[rgba(255,255,255,0.78)] mt-1 line-clamp-2">{tx(path.stressSource)}</p>
                  <p className="text-[9px] text-[rgba(255,255,255,0.62)] mt-2 line-clamp-2">
                    {path.nextTask ? tx('Next: {task}', { task: tx(path.nextTask) }) : tx('Badge ready to claim on your profile')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
    <JourneyMomentEditor
      open={Boolean(editingMoment)}
      value={editingMoment}
      saving={editingMoment?.type === 'schedule' ? scheduleBusyId === editingMoment.candidate.id : false}
      deleting={deletingMomentKey === (editingMoment?.type === 'schedule' ? `schedule:${editingMoment.candidate.id}` : editingMoment?.key)}
      onClose={() => setEditingMoment(null)}
      onSave={handleSaveMoment}
      onDelete={handleDeleteMoment}
    />
    <TodayCalendarPicker
      open={showCalendarPicker}
      selected={selectedDate}
      month={visibleMonth}
      minDate={registrationDate}
      maxDate={maxSelectableDate}
      onClose={() => setShowCalendarPicker(false)}
      onSelect={handleCalendarPick}
      onMonthChange={handleMonthChange}
    />

    {/* ── All practices bottom sheet ── */}
    {showAllPractices && (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(0,0,0,0.35)]"
        onClick={() => setShowAllPractices(false)}
      >
        <div
          className="bg-white w-full max-w-[430px] rounded-t-[24px] flex flex-col"
          style={{ maxHeight: 'min(82vh, 82dvh)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-9 h-1 rounded-full bg-[rgba(80,70,160,0.15)]" />
          </div>
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-2 pb-3 border-b border-[rgba(80,70,160,0.07)] flex-shrink-0">
            <p className="text-[15px] font-bold text-ink">{tx("Today's practices")}</p>
            <button
              type="button"
              onClick={() => setShowAllPractices(false)}
              className="w-8 h-8 rounded-full bg-bg-2 flex items-center justify-center text-[13px] text-ink-3 border-none"
            >
              ✕
            </button>
          </div>
          {/* List — use scroll-area for iOS momentum scroll */}
          <div className="scroll-area flex-1 px-4 pb-safe">
            {practiceTodos.length === 0 ? (
              <p className="text-[13px] text-ink-3 py-8 text-center">{tx('No pending practices right now.')}</p>
            ) : (
              <>
                {/* Pending */}
                {pendingPracticeTodos.length > 0 && (
                  <>
                    <p className="text-[10px] font-bold text-ink-4 uppercase tracking-wide pt-4 pb-2">{tx('Pending')}</p>
                    {pendingPracticeTodos.map((todo, index) => {
                      const isLast = index === pendingPracticeTodos.length - 1;
                      const sourceTone = getPracticeSourceTone(todo.sourceType);
                      return (
                        <div key={todo.id} className={`py-3 ${!isLast ? 'border-b border-[rgba(80,70,160,0.07)]' : ''}`}>
                          <div className={`flex items-start gap-3 rounded-[16px] px-3 py-3 border ${sourceTone.container}`}>
                            <button
                              type="button"
                              disabled={todoBusyId === todo.id}
                              onClick={() => toggleTodo(todo)}
                              className="mt-0.5 w-6 h-6 rounded-full border flex items-center justify-center text-[12px] transition-all disabled:opacity-40 bg-white border-[rgba(80,70,160,0.22)] text-transparent"
                            >✓</button>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-bold text-ink leading-snug">{tx(todo.title)}</p>
                              {todo.timeLabel && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-bg-2 text-ink-4 mt-1 inline-block">{todo.timeLabel}</span>}
                              <p className="text-[11px] text-ink-3 mt-1">{tx(todo.description)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
                {/* Completed */}
                {completedPracticeCount > 0 && (
                  <>
                    <p className="text-[10px] font-bold text-teal uppercase tracking-wide pt-5 pb-2">{tx('Completed')} · {completedPracticeCount}</p>
                    {practiceTodos.filter((todo) => todo.status === 'completed').map((todo, index, arr) => {
                      const isLast = index === arr.length - 1;
                      const sourceTone = getPracticeSourceTone(todo.sourceType);
                      return (
                        <div key={todo.id} className={`py-3 ${!isLast ? 'border-b border-[rgba(80,70,160,0.07)]' : ''}`}>
                          <div className={`flex items-start gap-3 rounded-[16px] px-3 py-3 border ${sourceTone.container} opacity-60`}>
                            <button
                              type="button"
                              disabled={todoBusyId === todo.id}
                              onClick={() => toggleTodo(todo)}
                              className="mt-0.5 w-6 h-6 rounded-full border flex items-center justify-center text-[12px] transition-all disabled:opacity-40 bg-teal border-teal text-white"
                            >✓</button>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-bold text-ink-3 line-through leading-snug">{tx(todo.title)}</p>
                              {todo.timeLabel && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-bg-2 text-ink-4 mt-1 inline-block">{todo.timeLabel}</span>}
                              <p className="text-[11px] text-ink-3 mt-1">{tx(todo.description)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}

type JourneyMomentEvent = {
  key?: string;
  t: string;
  app: string;
  s: number;
  note: string;
  source?: 'default' | 'schedule';
  candidate?: ScheduleCandidate;
};

function formatSchedulePrimary(candidate: { startTime: string | null; endTime?: string | null; dateText: string }) {
  const timeLabel = formatCandidateTimeLabel(candidate);
  const language = useStore.getState().language || 'zh-CN';
  return candidate.startTime ? timeLabel : `${timeLabel} · ${translateText(language, 'needs confirmation')}`;
}

function buildJournalPreview(text: string, fallback: string) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  if (normalized.length <= 88) return normalized;
  return `${normalized.slice(0, 88).trim()}…`;
}

function getPracticeSourceTone(sourceType: TodayTodo['sourceType']) {
  switch (sourceType) {
    case 'manual_schedule':
      return {
        container: 'bg-[rgba(124,102,199,0.08)] border-[rgba(124,102,199,0.16)]',
        sourceChip: 'bg-[rgba(124,102,199,0.14)] text-[#6450B2]',
        pathChip: 'bg-[rgba(124,102,199,0.1)] text-[#6450B2]',
      };
    case 'ai_suggestion':
      return {
        container: 'bg-[rgba(255,212,143,0.16)] border-[rgba(227,164,58,0.24)]',
        sourceChip: 'bg-[rgba(227,164,58,0.16)] text-[#9A6A00]',
        pathChip: 'bg-[rgba(227,164,58,0.12)] text-[#9A6A00]',
      };
    case 'path_task':
      return {
        container: 'bg-[rgba(91,173,151,0.1)] border-[rgba(91,173,151,0.2)]',
        sourceChip: 'bg-[rgba(91,173,151,0.16)] text-[#2F8470]',
        pathChip: 'bg-[rgba(47,132,112,0.16)] text-[#2F8470]',
      };
    default:
      return {
        container: 'bg-bg-2 border-[rgba(80,70,160,0.08)]',
        sourceChip: 'bg-[rgba(80,70,160,0.08)] text-ink-3',
        pathChip: 'bg-[rgba(58,136,128,0.08)] text-teal',
      };
  }
}

function formatCandidateTimeLabel(candidate: { startTime: string | null; endTime?: string | null; dateText: string }) {
  const language = useStore.getState().language || 'zh-CN';
  const locale = getIntlLocale(language);
  if (candidate.startTime) {
    const date = new Date(candidate.startTime.replace(' ', 'T'));
    if (!Number.isNaN(date.getTime())) {
      const base = `${formatDateLabel(date, language, locale)} ${formatClock(date, language, locale)}`;
      if (candidate.endTime) {
        const endDate = new Date(candidate.endTime.replace(' ', 'T'));
        if (!Number.isNaN(endDate.getTime())) {
          return `${base}-${formatClock(endDate, language, locale)}`;
        }
      }
      return base;
    }
  }
  return candidate.dateText || translateText(language, 'Time needs confirmation');
}

function formatDateLabel(date: Date, language: string, locale: string) {
  return new Intl.DateTimeFormat(locale, language === 'zh-CN'
    ? { month: '2-digit', day: '2-digit' }
    : { month: 'short', day: 'numeric' }).format(date);
}

function formatClock(date: Date, language: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: language !== 'zh-CN',
  }).format(date);
}

function getCandidateDateKey(candidate: ScheduleCandidate) {
  if (candidate.startTime) {
    return candidate.startTime.slice(0, 10);
  }
  const metaDate = candidate.meta && typeof candidate.meta === 'object'
    ? ((candidate.meta as Record<string, unknown>).dateInfo as Record<string, unknown> | undefined)?.date
    : null;
  return typeof metaDate === 'string' ? metaDate.slice(0, 10) : null;
}

function toScheduleMomentEvent(candidate: ScheduleCandidate): JourneyMomentEvent {
  return {
    key: `schedule:${candidate.id}`,
    t: extractMomentTime(candidate),
    app: deriveScheduleSlotLabel(candidate),
    s: deriveScheduleStress(candidate),
    note: formatScheduleEventTitle(candidate),
    source: 'schedule',
    candidate,
  };
}

function extractMomentTime(candidate: ScheduleCandidate) {
  const language = useStore.getState().language || 'zh-CN';
  if (candidate.startTime) {
    const date = new Date(candidate.startTime.replace(' ', 'T'));
    if (!Number.isNaN(date.getTime())) {
      if (candidate.endTime) {
        const endDate = new Date(candidate.endTime.replace(' ', 'T'));
        if (!Number.isNaN(endDate.getTime())) {
          return formatMomentRange(date, endDate);
        }
      }
      return formatMomentClock(date);
    }
  }
  return candidate.dateText || translateText(language, 'planned');
}

function deriveScheduleSlotLabel(candidate: ScheduleCandidate) {
  if (candidate.location) return candidate.location;
  if (candidate.participants.length > 0) return candidate.participants[0];
  return deriveScheduleCategory(candidate);
}

function deriveScheduleCategory(candidate: ScheduleCandidate) {
  const text = `${candidate.title} ${candidate.location} ${candidate.participants.join(' ')}`.toLowerCase();
  if (/吃饭|午餐|晚餐|咖啡|lunch|dinner|coffee/.test(text)) return 'Meal';
  if (/医院|医生|复诊|复查|看牙|appointment|doctor/.test(text)) return 'Health';
  if (/老板|面试|开会|聊|沟通|meeting|interview|review/.test(text)) return 'Meeting';
  if (/打球|健身|训练|跑步|游泳|爬山|运动/.test(text)) return 'Exercise';
  return 'Planned';
}

function deriveScheduleStress(candidate: ScheduleCandidate) {
  const text = `${candidate.title} ${candidate.location}`.toLowerCase();
  if (/离职|面试|老板|医院|复诊|复查/.test(text)) return 6;
  if (/聊|沟通|meeting|appointment/.test(text)) return 5;
  return 3;
}

function buildDefaultMomentKey(dateKey: string | null, event: Omit<JourneyMomentEvent, 'key'> | JourneyMomentEvent) {
  return `default:${dateKey || 'unknown'}:${event.t}:${event.app}:${event.note}`;
}

function getMomentTone(stress: number) {
  if (stress >= 8) {
    return { dot: '#C4527A', bg: 'rgba(196,82,122,0.12)' };
  }
  if (stress <= 3) {
    return { dot: '#3A8880', bg: 'rgba(58,136,128,0.12)' };
  }
  return { dot: '#B89020', bg: 'rgba(184,144,32,0.14)' };
}

function formatScheduleEventTitle(candidate: ScheduleCandidate) {
  const language = useStore.getState().language || 'zh-CN';
  let title = String(candidate.title || '').trim();
  const location = String(candidate.location || '').trim();
  if (location) {
    title = title
      .replace(new RegExp(`^(在|到|去)?\\s*${escapeRegExp(location)}`), '')
      .trim();
  }
  return title || candidate.title || translateText(language, 'Planned activity');
}

function compareMomentEventTime(left: JourneyMomentEvent, right: JourneyMomentEvent) {
  return getMomentSortValue(left) - getMomentSortValue(right);
}

function getMomentSortValue(event: JourneyMomentEvent) {
  if (event.source === 'schedule' && event.candidate?.startTime) {
    const date = new Date(event.candidate.startTime.replace(' ', 'T'));
    if (!Number.isNaN(date.getTime())) {
      return date.getHours() * 60 + date.getMinutes();
    }
  }
  return parseMomentSortValue(event.t);
}

function parseMomentSortValue(label: string) {
  const normalized = String(label || '').trim().toLowerCase();
  const colonMatch = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (colonMatch) {
    let hour = Number(colonMatch[1]);
    const minute = Number(colonMatch[2] || 0);
    const meridiem = colonMatch[3];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return hour * 60 + minute;
  }
  if (/早上|今早|明早|morning/.test(normalized)) return 8 * 60;
  if (/中午|noon/.test(normalized)) return 12 * 60;
  if (/下午|afternoon/.test(normalized)) return 15 * 60;
  if (/晚上|今晚|evening|night/.test(normalized)) return 19 * 60;
  return Number.MAX_SAFE_INTEGER;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfMonth(date: Date) {
  const next = startOfDay(date);
  next.setDate(1);
  return next;
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey: string | null) {
  if (!dateKey) return null;
  const date = new Date(`${dateKey}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next;
}

function differenceInCalendarDays(left: Date, right: Date) {
  const leftStart = startOfDay(left).getTime();
  const rightStart = startOfDay(right).getTime();
  return Math.round((leftStart - rightStart) / 86400000);
}

function clampDate(date: Date, min: Date, max: Date) {
  if (date < min) return startOfDay(min);
  if (date > max) return startOfDay(max);
  return startOfDay(date);
}

function clampMonth(date: Date, min: Date, max: Date) {
  const month = startOfMonth(date);
  const minMonth = startOfMonth(min);
  const maxMonth = startOfMonth(max);
  if (month < minMonth) return minMonth;
  if (month > maxMonth) return maxMonth;
  return month;
}

function endOfMonth(date: Date) {
  const next = startOfMonth(date);
  next.setMonth(next.getMonth() + 1);
  next.setDate(0);
  return startOfDay(next);
}

function formatMonthKey(date: Date) {
  return formatDateKey(startOfMonth(date)).slice(0, 7);
}

function getMonthTimeline(min: Date, max: Date) {
  const months: Array<{ key: string; label: string; start: Date; end: Date }> = [];
  const locale = getCurrentLocale();
  for (let cursor = startOfMonth(min); cursor <= startOfMonth(max); cursor = addMonths(cursor, 1)) {
    const monthStart = clampDate(cursor, min, max);
    const monthEnd = clampDate(endOfMonth(cursor), min, max);
    months.push({
      key: formatMonthKey(cursor),
      label: new Intl.DateTimeFormat(locale, { month: 'short' }).format(cursor),
      start: monthStart,
      end: monthEnd,
    });
  }
  return months;
}

function addMonths(date: Date, months: number) {
  const next = startOfMonth(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function formatSelectedDateButton(date: Date, locale: string, isToday = false) {
  const base = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
  if (!isToday) return base;
  const language = useStore.getState().language || 'zh-CN';
  return `${base} ${language === 'zh-CN' ? '（今天）' : '(Today)'}`;
}

function getCurrentLocale() {
  return getIntlLocale(useStore.getState().language || 'zh-CN');
}

function formatCardDateLabel(date: Date, locale = getCurrentLocale()) {
  return date.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' });
}

function buildSelectedDayData({
  date,
  profile,
}: {
  date: Date;
  profile?: DayProfile;
}) {
  return {
    day: date.toLocaleDateString(getCurrentLocale(), { weekday: 'short' }),
    date: formatDateKey(date),
    avgS: profile ? getDisplayStress(profile, 0) : 0,
    emo: profile && profile.mood_avg != null
      ? Math.min(4, Math.max(0, Math.round((1 - toNumber(profile.composite_mood ?? profile.mood_avg, 3) / 5) * 4)))
      : null,
    events: [],
  };
}

function formatMomentClock(date: Date) {
  const language = useStore.getState().language || 'zh-CN';
  const locale = getIntlLocale(language);
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: language !== 'zh-CN',
  }).format(date);
}

function formatMomentRange(start: Date, end: Date) {
  return `${formatMomentClock(start)}-${formatMomentClock(end)}`;
}

function escapeRegExp(text: string) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readCandidateNotes(candidate: ScheduleCandidate) {
  return typeof candidate.meta?.notes === 'string' ? candidate.meta.notes : '';
}

function formatSelectedDateLabel(dateKey: string | null, isTodaySelected: boolean) {
  const language = useStore.getState().language || 'zh-CN';
  if (!dateKey) return isTodaySelected ? translateText(language, 'Today') : translateText(language, 'This day');
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isTodaySelected ? translateText(language, 'Today') : dateKey;
  const base = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
  return isTodaySelected ? translateText(language, 'Today ({date})', { date: base }) : base;
}

function buildHistoricalNotice({
  dateLabel,
  dayLabel,
  avgStress,
  peakStress,
  peakEvent,
  momentCount,
}: {
  dateLabel: string;
  dayLabel: string;
  avgStress: number;
  peakStress: number;
  peakEvent: JourneyMomentEvent | null;
  momentCount: number;
}) {
  const language = useStore.getState().language || 'zh-CN';
  if (momentCount === 0) {
    return translateText(language, '{dateLabel} ({dayLabel}) doesn’t have any saved moments yet. You can still add plans here or use William to reflect on that day.', {
      dateLabel,
      dayLabel,
    });
  }
  if (peakEvent && peakStress >= 6) {
    return translateText(language, '{dateLabel} ({dayLabel}) peaked at {peakStress}/10 around {time} during {app} — {note}. Want to look at what made that moment heavier?', {
      dateLabel,
      dayLabel,
      peakStress,
      time: peakEvent.t,
      app: translateText(language, peakEvent.app),
      note: translateText(language, peakEvent.note),
    });
  }
  if (avgStress <= 3.5) {
    return translateText(language, '{dateLabel} ({dayLabel}) looked steadier, averaging {avgStress}/10 across {momentCount} moments. Want to note what helped that day feel lighter?', {
      dateLabel,
      dayLabel,
      avgStress: avgStress.toFixed(1),
      momentCount,
    });
  }
  return translateText(language, '{dateLabel} ({dayLabel}) averaged {avgStress}/10 across {momentCount} moments. Want to review what was taking up the most space that day?', {
    dateLabel,
    dayLabel,
    avgStress: avgStress.toFixed(1),
    momentCount,
  });
}
