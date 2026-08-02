import { type ReactNode, useMemo, useState } from 'react';
import { SectionLabel } from '@/components/ui';
import type { DayProfile } from '@/services/store';
import { useI18n } from '@/i18n/useI18n';
import { MOOD_EMOJI, MOOD_LABEL } from '@/utils/data';
import { getDisplayStress, getStressSource, hasAmbientSignal, toNumber } from '@/utils/wellbeing';

export default function WeeklyMoodCard({
  history,
  streak,
  titleClassName = '',
  action = null,
  summary = null,
}: {
  history: DayProfile[];
  streak: number;
  titleClassName?: string;
  action?: ReactNode;
  summary?: ReactNode;
}) {
  const { tx, locale } = useI18n();
  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number | null>(null);

  const weekData = useMemo(() => (
    history.length > 0
      ? [...history]
          .sort((left, right) => String(left.date).localeCompare(String(right.date)))
          .slice(-7)
          .map((day, index, rows) => ({
            day: day.date ? new Date(`${day.date}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' }) : (day.day_of_week?.slice(0, 2) || String(index + 1)),
            avgS: getDisplayStress(day, 0),
            emo: Math.max(0, Math.min(4, Math.round(toNumber(day.composite_mood ?? day.mood_avg, 2)))),
            isToday: index === rows.length - 1,
            stressSource: getStressSource(day),
            hasAmbient: hasAmbientSignal(day),
          }))
      : []
  ), [history, locale]);

  const activeWeekIndex = selectedWeekIndex != null && selectedWeekIndex < weekData.length
    ? selectedWeekIndex
    : Math.max(weekData.length - 1, 0);
  const activeWeekData = weekData[activeWeekIndex] ?? { day: '—', avgS: 0, emo: 2, isToday: false, stressSource: '', hasAmbient: false };

  const activeStressSummary = activeWeekData.avgS >= 7
    ? tx('压力明显偏高，值得优先处理。')
    : activeWeekData.avgS >= 4
      ? tx('压力在中段，已经开始累积。')
      : tx('整体还算平稳，适合继续保持。');
  const activeMoodSummary = [
    tx('状态不错，可以把这个节奏继续保护住。'),
    tx('整体还可以，但还是要留意消耗。'),
    tx('今天比较中性，可能更需要一点觉察。'),
    tx('情绪偏低，适合给自己更多缓冲。'),
    tx('情绪比较紧绷，建议先降压再处理事情。'),
  ][activeWeekData.emo] ?? tx('今天的情绪需要再观察一下。');

  return (
    <div>
      <div className={`flex items-center justify-between mb-2.5 ${titleClassName}`.trim()}>
        <SectionLabel>{tx('This Week')}</SectionLabel>
        <div className="flex items-center gap-2">
          {action}
          <span className="text-[10px] text-ink-4">🔥 {streak} {tx('day streak')}</span>
        </div>
      </div>
      <div className="bg-white rounded-2xl p-4 border border-[rgba(80,70,160,0.1)] shadow-card">
        {summary && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-[14px] bg-[rgba(80,70,160,0.05)] border border-[rgba(80,70,160,0.08)] px-3 py-2">
            <div className="min-w-0">{summary}</div>
          </div>
        )}
        {weekData.length === 0 ? (
          <div className="rounded-[14px] bg-bg-2 border border-[rgba(80,70,160,0.08)] p-4 text-center">
            <p className="text-[13px] font-semibold text-ink">{tx('No wellbeing history yet.')}</p>
            <p className="text-[11px] text-ink-4 mt-1">{tx('Check in with mood, journal, or today tasks to start building this view.')}</p>
          </div>
        ) : (
          <>
            <div className="flex justify-around mb-3">
              {weekData.map((day, index) => {
                const intensity = day.avgS <= 3 ? '#3A8880' : day.avgS <= 6 ? '#B89020' : '#C4527A';
                return (
                  <button
                    key={`${day.day}-${index}`}
                    type="button"
                    onClick={() => setSelectedWeekIndex(index)}
                    className="flex flex-col items-center gap-1 bg-transparent border-none cursor-pointer"
                  >
                    <span className="text-[9px] font-semibold text-ink-4">{day.day}</span>
                    <div
                      className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[14px]"
                      style={{
                        background: day.avgS > 0 ? `${intensity}22` : 'rgba(28,24,48,0.05)',
                        border: activeWeekIndex === index ? '2px solid #8B7FCC' : `1.5px solid ${intensity}44`,
                      }}
                    >
                      {MOOD_EMOJI[day.emo] || '😐'}
                    </div>
                    <span className="text-[9px] font-semibold" style={{ color: intensity }}>{day.avgS.toFixed(0)}</span>
                  </button>
                );
              })}
            </div>
            <div className="rounded-[14px] bg-bg-2 border border-[rgba(80,70,160,0.08)] p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-[12px] font-bold text-ink">
                  {activeWeekData.isToday ? tx('Today') : tx(activeWeekData.day)} · {MOOD_EMOJI[activeWeekData.emo] || '😐'} {tx(MOOD_LABEL[activeWeekData.emo] || 'Okay')}
                </p>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white border border-[rgba(80,70,160,0.1)] text-ink-3">
                  {activeWeekData.avgS >= 7 ? tx('High') : activeWeekData.avgS >= 4 ? tx('Moderate') : tx('Steady')}
                </span>
              </div>
              <p className="text-[11px] text-ink-3 leading-relaxed">{activeStressSummary}</p>
              <p className="text-[11px] text-ink-4 mt-1 leading-relaxed">{activeMoodSummary}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
