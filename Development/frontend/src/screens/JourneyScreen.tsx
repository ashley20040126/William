import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, ProgressBar, SectionLabel } from '@/components/ui';
import WeeklyMoodCard from '@/components/WeeklyMoodCard';
import StoryCard from '@/components/StoryCard';
import { useStore } from '@/services/store';
import * as api from '@/services/api';
import type { DailyStory } from '@/services/journeyApi';
import { useI18n } from '@/i18n/useI18n';

export default function JourneyScreen() {
  const nav = useNavigate();
  const { tx, locale } = useI18n();
  const feed = useStore((s) => s.todayFeed);
  const token = useStore((s) => s.token);
  const history = useStore((s) => s.history);
  const streak = useStore((s) => s.streak);
  const setTodayFeed = useStore((s) => s.setTodayFeed);
  const setHistory = useStore((s) => s.setHistory);
  const [showWeeklyStories, setShowWeeklyStories] = useState(false);
  const [storiesLoading, setStoriesLoading] = useState(false);
  const [storiesError, setStoriesError] = useState<string | null>(null);
  const [weeklyStories, setWeeklyStories] = useState<DailyStory[]>([]);
  const [selectedStoryDate, setSelectedStoryDate] = useState<string | null>(null);
  const paths = feed?.monthlyPaths || [];

  useEffect(() => {
    if (!token || feed?.monthlyPaths) return;
    api.getTodayFeed().then((nextFeed) => {
      if (nextFeed) {
        setTodayFeed(nextFeed as Parameters<typeof setTodayFeed>[0]);
      }
    });
  }, [token, feed?.monthlyPaths, setTodayFeed]);

  useEffect(() => {
    if (!token || history.length >= 7) return;
    api.getHistory(7).then((rows) => {
      if (rows) {
        setHistory(rows as Parameters<typeof setHistory>[0]);
      }
    });
  }, [token, history.length, setHistory]);

  useEffect(() => {
    if (!token || weeklyStories.length > 0 || storiesLoading) return;
    setStoriesLoading(true);
    setStoriesError(null);
    api.getRecentStories(7).then((stories) => {
      const nextStories = Array.isArray(stories) ? stories : [];
      setWeeklyStories(nextStories);
      if (nextStories.length > 0) {
        setSelectedStoryDate((current) => current || nextStories[0].date);
      }
    }).catch((error) => {
      setStoriesError(error instanceof Error ? error.message : tx('Failed to load weekly comics'));
    }).finally(() => {
      setStoriesLoading(false);
    });
  }, [token, weeklyStories.length, storiesLoading, tx]);

  const activePaths = paths.filter((path) => path.status !== 'completed');
  const completedPaths = paths.filter((path) => path.status === 'completed');
  const weeklyStorySlots = buildWeeklyStorySlots(weeklyStories, locale);
  const generatedStoryCount = weeklyStorySlots.filter((slot) => Boolean(slot.story)).length;
  const activeStoryDate = selectedStoryDate || weeklyStorySlots[weeklyStorySlots.length - 1]?.date || null;
  const activeStorySlot = weeklyStorySlots.find((slot) => slot.date === activeStoryDate) || null;

  async function openWeeklyStories() {
    setShowWeeklyStories(true);
    if (!selectedStoryDate && weeklyStorySlots.length > 0) {
      const latestAvailable = [...weeklyStorySlots].reverse().find((slot) => slot.story)?.date || weeklyStorySlots[weeklyStorySlots.length - 1]?.date || null;
      setSelectedStoryDate(latestAvailable);
    }
  }

  return (
    <div className="h-full flex flex-col bg-[radial-gradient(circle_at_top,#F7F1E8_0%,#EEF4FF_42%,#F8F7FC_100%)]">
      <div
        className="flex-shrink-0 px-5 pb-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top,8px), 8px)' }}
      >
        <div className="flex items-baseline gap-3">
          <h1 className="text-heading text-[28px] text-ink">{tx('Your Paths')}</h1>
          <span className="text-[13px] font-semibold text-ink-4">{tx('Monthly challenges')}</span>
        </div>
        <p className="text-[13px] text-ink-3 mt-2 leading-relaxed">{tx('This page shows every recovery path William planned for the month, including active and completed ones.')}</p>
      </div>

      <div className="flex-1 overflow-y-auto scroll-area px-4 pb-8">
        <WeeklyMoodCard
          history={history}
          streak={streak}
          action={(
            <button
              type="button"
              onClick={openWeeklyStories}
              className="text-[10px] font-semibold text-warm bg-transparent border-none cursor-pointer"
            >
              {tx('Weekly comic recap')}
            </button>
          )}
          summary={(
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-4">{tx('Weekly comics')}</p>
                <p className="text-[12px] font-semibold text-ink">{tx('{count}/7 days generated', { count: generatedStoryCount })}</p>
              </div>
              <span className="text-[18px]">🎞️</span>
            </div>
          )}
        />

        <div className="mt-5" />

        <PathSection
          title={tx('Active paths')}
          subtitle={tx('Still in progress this month')}
          paths={activePaths}
          onOpen={(pathId) => nav(`/path/${pathId}`)}
          emptyText={tx('No active paths yet.')}
        />

        <div className="mt-5" />

        <PathSection
          title={tx('Completed paths')}
          subtitle={tx('Already finished and badge-worthy')}
          paths={completedPaths}
          onOpen={(pathId) => nav(`/path/${pathId}`)}
          emptyText={tx('No completed paths yet.')}
        />
      </div>

      {showWeeklyStories && (
        <div className="fixed inset-0 z-50 flex flex-col bg-bg" style={{ maxWidth: 430, margin: '0 auto' }}>
          <div className="flex-shrink-0 flex items-center gap-3 px-5 py-4 border-b border-[rgba(80,70,160,0.08)]" style={{ paddingTop: 'max(env(safe-area-inset-top,16px),16px)' }}>
            <button
              type="button"
              onClick={() => setShowWeeklyStories(false)}
              className="w-8 h-8 rounded-full bg-bg-2 flex items-center justify-center text-[18px] border-none cursor-pointer"
            >
              ←
            </button>
            <div>
              <h2 className="font-fraunces text-[20px] font-bold italic text-ink">{tx('Weekly comic recap')}</h2>
              <p className="text-[12px] text-ink-4 mt-0.5">{tx('AI-generated story cards for the last 7 days.')}</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto scroll-area px-4 py-4 pb-8">
            {storiesLoading ? (
              <Card className="p-4">
                <p className="text-[13px] text-ink-3">{tx('Generating weekly comics…')}</p>
              </Card>
            ) : storiesError ? (
              <Card className="p-4">
                <p className="text-[13px] text-rose">{storiesError}</p>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {weeklyStorySlots.map((slot) => {
                    const isActive = slot.date === activeStoryDate;
                    return (
                      <button
                        key={slot.date}
                        type="button"
                        onClick={() => setSelectedStoryDate(slot.date)}
                        className={`min-w-[72px] px-3 py-2 rounded-2xl border text-left ${isActive ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-[rgba(80,70,160,0.1)]'}`}
                      >
                        <p className={`text-[10px] font-semibold ${isActive ? 'text-white/70' : 'text-ink-4'}`}>{slot.weekday}</p>
                        <p className="text-[12px] font-bold mt-0.5">{slot.dayLabel}</p>
                        <p className={`text-[10px] mt-1 ${isActive ? 'text-white/80' : slot.story ? 'text-teal' : 'text-ink-4'}`}>
                          {slot.story ? tx('Ready') : tx('Pending')}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {activeStorySlot?.story ? (
                  <StoryCard
                    story={activeStorySlot.story}
                    dateLabel={activeStorySlot.fullLabel}
                  />
                ) : activeStorySlot ? (
                  <Card className="p-5">
                    <p className="text-[14px] font-bold text-ink">{activeStorySlot.fullLabel}</p>
                    <p className="text-[12px] text-ink-4 mt-2 leading-relaxed">
                      {generatedStoryCount === 0 ? tx('No weekly comics yet.') : tx('Comic recap not generated for this day yet.')}
                    </p>
                  </Card>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function buildWeeklyStorySlots(stories: DailyStory[], locale: string) {
  const storyByDate = new Map(stories.map((story) => [story.date, story]));
  const slots: Array<{
    date: string;
    weekday: string;
    dayLabel: string;
    fullLabel: string;
    story: DailyStory | null;
  }> = [];
  const today = new Date();

  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const dateKey = date.toISOString().slice(0, 10);
    slots.push({
      date: dateKey,
      weekday: date.toLocaleDateString(locale, { weekday: 'short' }),
      dayLabel: date.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
      fullLabel: date.toLocaleDateString(locale, { month: 'short', day: 'numeric', weekday: 'long' }),
      story: storyByDate.get(dateKey) || null,
    });
  }

  return slots;
}

function PathSection({
  title,
  subtitle,
  paths,
  onOpen,
  emptyText,
}: {
  title: string;
  subtitle: string;
  paths: Array<{
    id: string;
    title: string;
    summary: string;
    stressSource: string;
    badgeLabel: string;
    status: 'active' | 'completed';
    icon: string;
    gradient: [string, string];
    progress: { completed: number; total: number };
    nextTask: string | null;
  }>;
  onOpen: (pathId: string) => void;
  emptyText: string;
}) {
  const { tx } = useI18n();
  return (
    <section>
      <SectionLabel>{title}</SectionLabel>
      <p className="text-[13px] text-ink-3 mt-1">{subtitle}</p>

      {paths.length === 0 ? (
        <Card className="p-4 mt-3">
          <p className="text-[13px] text-ink-4">{emptyText}</p>
        </Card>
      ) : (
        <div className="space-y-3 mt-3">
          {paths.map((path) => (
            <button
              key={path.id}
              type="button"
              onClick={() => onOpen(path.id)}
              className="w-full text-left bg-transparent border-none p-0 cursor-pointer"
            >
              <Card className="overflow-hidden">
                <div
                  className="px-4 py-4"
                  style={{ background: `linear-gradient(135deg, ${path.gradient[0]}, ${path.gradient[1]})` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[24px]">{path.icon}</p>
                      <p className="text-[16px] font-bold text-white mt-2">{tx(path.title)}</p>
                      <p className="text-[12px] text-white/82 mt-1 leading-relaxed">{tx(path.summary)}</p>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-white/18 text-white/90">
                      {path.status === 'completed' ? tx('Completed') : tx('In progress')}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap mt-3">
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-white/18 text-white/90">
                      {tx('Stressor: {stressor}', { stressor: tx(path.stressSource) })}
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-white/18 text-white/90">
                      {tx('Badge: {badge}', { badge: tx(path.badgeLabel) })}
                    </span>
                  </div>
                </div>

                <div className="px-4 py-4">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-ink-3">
                    <span>{tx('Progress')}</span>
                    <span>{path.progress.completed}/{path.progress.total}</span>
                  </div>
                  <ProgressBar
                    pct={path.progress.total > 0 ? (path.progress.completed / path.progress.total) * 100 : 0}
                    gradient={path.gradient}
                    className="mt-2"
                    trackColor="rgba(80,70,160,0.08)"
                  />
                  <p className="text-[12px] text-ink-3 mt-3">
                    {path.nextTask
                      ? tx('Next task: {task}', { task: tx(path.nextTask) })
                      : tx('All tasks completed. Open to review the full checklist.')}
                  </p>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
