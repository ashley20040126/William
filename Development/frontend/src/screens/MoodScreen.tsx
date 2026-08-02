import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '@/services/store';
import * as api from '@/services/api';
import { MOOD_EMOJI, MOOD_LABEL } from '@/utils/data';
import { Button } from '@/components/ui';
import { haptic } from '@/hooks/useWebViewBridge';
import { useI18n } from '@/i18n/useI18n';

const STRESS_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1);
const MOOD_OPTIONS = MOOD_EMOJI.map((emoji, index) => ({
  emoji,
  label: MOOD_LABEL[index],
  value: index,
}));

export default function MoodScreen() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const s = useStore();
  const { tx, locale } = useI18n();
  const requestedDate = normalizeJournalDateParam(searchParams.get('date'));
  const todayKey = getTodayDateKey();
  const existingJournal = s.journals.find((entry) => entry.date === requestedDate) || null;
  const [text, setText] = useState(existingJournal?.text || '');
  const [mood, setMood] = useState(existingJournal?.mood ?? 2);
  const [stress, setStress] = useState(existingJournal?.stress ?? 5);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const lastLoadedDateRef = useRef<string | null>(null);
  const hasUserEditedRef = useRef(false);

  const currentDate = useMemo(() => {
    return new Date(`${requestedDate}T12:00:00`).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      weekday: 'short',
    });
  }, [locale, requestedDate]);

  useEffect(() => {
    if (lastLoadedDateRef.current === requestedDate) return;
    lastLoadedDateRef.current = requestedDate;
    hasUserEditedRef.current = false;
    let active = true;
    setLoading(true);
    setError('');

    if (existingJournal) {
      setText(existingJournal.text || '');
      setMood(existingJournal.mood ?? 2);
      setStress(existingJournal.stress ?? 5);
    } else {
      setText('');
      setMood(2);
      setStress(5);
    }

    api.getJournal(requestedDate).then((entry) => {
      if (!active) return;
      if (entry) {
        useStore.getState().upsertJournal(entry);
        if (!hasUserEditedRef.current) {
          setText(entry.text || '');
          setMood(entry.mood ?? 2);
          setStress(entry.stress ?? 5);
        }
      } else {
        if (!hasUserEditedRef.current) {
          setText('');
          setMood(2);
          setStress(5);
        }
      }
      if (requestedDate === todayKey) {
        useStore.getState().set({ dailyDone: Boolean(entry) });
      }
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [requestedDate, todayKey]);

  const canSave = text.trim().length > 0 && !saving;

  const save = async () => {
    const value = text.trim();
    if (!value || saving) return;

    setSaving(true);
    setError('');
    haptic('medium');

    const entryDay = new Date(`${requestedDate}T12:00:00`);
    const weekday = entryDay.toLocaleDateString('en', { weekday: 'long' });
    const nextHistory = (() => {
      const existingIndex = s.history.findIndex((item) => item.date === requestedDate);
      if (existingIndex >= 0) {
        return s.history.map((item, index) => (
          index === existingIndex
            ? {
                ...item,
                day_of_week: item.day_of_week || weekday,
                mood_avg: mood,
                composite_mood: mood,
                stress_avg: stress,
                stress_peak: Math.max(Number(item.stress_peak ?? 0), stress),
                composite_stress: stress,
              }
            : item
        ));
      }

      return [
        {
          date: requestedDate,
          day_of_week: weekday,
          composite_stress: stress,
          composite_mood: mood,
          mood_avg: mood,
          stress_avg: stress,
          stress_peak: stress,
          ambient_stress_avg: null,
          ambient_stress_peak: null,
          ambient_listening_count: 0,
          ambient_transcript_tokens: 0,
          practice_count: 0,
        },
        ...s.history,
      ];
    })();

    try {
      const wasExisting = Boolean(existingJournal);
      const response = await api.saveJournalOrThrow(value, { mood, stress, date: requestedDate });
      const savedJournal = response?.journal || {
        date: requestedDate,
        text: value,
        mood,
        stress,
        analysis: { mood, stress },
      };
      s.upsertJournal(savedJournal);
      s.set({
        history: nextHistory,
        dailyDone: requestedDate === todayKey ? true : s.dailyDone,
      });
      if (!wasExisting) {
        s.addXP(25);
      }
      nav('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('Failed to save journal'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full max-w-[430px] mx-auto bg-bg overflow-y-auto scroll-area">
      <div className="p-6" style={{ paddingTop: 'max(env(safe-area-inset-top, 20px), 20px)' }}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[11px] font-bold text-ink-4 uppercase tracking-wider mb-1">{tx('Daily Journal')}</p>
            <h1 className="text-heading text-[26px] text-ink">{tx(existingJournal ? 'Edit journal entry' : 'Write journal entry')}</h1>
          </div>
          <button onClick={() => nav(-1)} className="text-2xl text-ink-3 bg-transparent border-none cursor-pointer">✕</button>
        </div>

        <div className="bg-white border border-[rgba(80,70,160,0.08)] rounded-[28px] p-5 shadow-sm mb-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-2xl bg-warm-light flex items-center justify-center">
              <span className="text-[22px]">📓</span>
            </div>
            <div>
              <p className="text-sm font-bold text-ink">{tx('What feels most alive today?')}</p>
              <p className="text-[11px] text-ink-4">{currentDate} · {tx(existingJournal ? 'You can update this entry anytime.' : 'William will analyze your journal.')}</p>
            </div>
          </div>

          <div className="mb-5">
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-[12px] font-semibold text-ink">{tx('How are you feeling?')}</p>
              <p className="text-[12px] text-ink-4">{tx(MOOD_OPTIONS[mood]?.label || '')}</p>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {MOOD_OPTIONS.map((option) => {
                const active = option.value === mood;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      hasUserEditedRef.current = true;
                      setMood(option.value);
                    }}
                    className={[
                      'flex flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-3 transition',
                      active
                        ? 'border-warm bg-warm-light shadow-sm'
                        : 'border-[rgba(80,70,160,0.12)] bg-bg-2 hover:border-warm/50',
                    ].join(' ')}
                  >
                    <span className="text-[22px] leading-none">{option.emoji}</span>
                    <span className="text-[10px] font-semibold text-ink-3">{tx(option.label)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-5">
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-[12px] font-semibold text-ink">{tx('Stress level')}</p>
              <p className="text-[12px] text-ink-4">{stress}/10</p>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {STRESS_OPTIONS.map((value) => {
                const active = value === stress;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      hasUserEditedRef.current = true;
                      setStress(value);
                    }}
                    className={[
                      'h-11 rounded-2xl border text-[14px] font-semibold transition',
                      active
                        ? 'border-warm bg-warm text-white shadow-sm'
                        : 'border-[rgba(80,70,160,0.12)] bg-bg-2 text-ink hover:border-warm/50',
                    ].join(' ')}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 px-1 text-[11px] text-ink-4">{tx('Keep the quick stress check-in, then write the fuller journal entry below.')}</p>
          </div>

          <textarea
            value={text}
            onChange={(event) => {
              hasUserEditedRef.current = true;
              setText(event.target.value);
            }}
            placeholder={tx('Write freely. What happened today? What felt heavy, meaningful, unfinished, or surprising?')}
            rows={12}
            className="w-full bg-bg-2 border-[1.5px] border-[rgba(80,70,160,0.1)] rounded-3xl p-4 text-[15px] text-ink resize-none outline-none focus:border-warm leading-relaxed"
          />

          <div className="flex items-center justify-between mt-3 px-1">
            <p className="text-[11px] text-ink-4">{tx(existingJournal ? 'Updates stay editable' : 'First save gives +25 XP')}</p>
            <p className="text-[11px] text-ink-4">{text.trim().length} {tx('chars')}</p>
          </div>
          {error ? (
            <p className="mt-3 px-1 text-[12px] text-rose">{error}</p>
          ) : null}
        </div>

        <Button full disabled={!canSave} onClick={save}>
          {saving ? tx('Saving…') : tx(existingJournal ? 'Update journal entry' : 'Save journal entry')}
        </Button>
      </div>
    </div>
  );
}

function getTodayDateKey() {
  return new Date().toISOString().split('T')[0];
}

function normalizeJournalDateParam(value: string | null) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  return getTodayDateKey();
}
