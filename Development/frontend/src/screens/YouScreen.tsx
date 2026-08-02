import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '@/services/store';
import * as api from '@/services/api';
import { calcLevel, LEVEL_TITLE, LEVEL_XP } from '@/utils/data';
import { toNumber } from '@/utils/wellbeing';
import { ProgressBar, SectionLabel } from '@/components/ui';
import type { DayProfile, EarnedBadge } from '@/services/store';
import { useI18n } from '@/i18n/useI18n';


function WellbeingRadar({ wellbeingAvg }: { wellbeingAvg: number }) {
  const { tx } = useI18n();
  const cx = 130, cy = 100, r = 65;
  const calm = Math.max(0, 1 - wellbeingAvg / 10);
  const dims = [
    { label: tx('Mood'), v: Math.max(0.15, calm * 0.9 + 0.1) },
    { label: tx('Sleep'), v: 0.6 },
    { label: tx('Stress'), v: Math.max(0.15, calm) },
    { label: tx('Focus'), v: Math.max(0.15, calm * 0.7 + 0.2) },
    { label: tx('Social'), v: 0.6 },
    { label: tx('Energy'), v: Math.max(0.15, calm * 0.6 + 0.2) },
  ];
  const n = dims.length;
  const pt = (i: number, v: number) => {
    const a = (i * 2 * Math.PI / n) - Math.PI / 2;
    return { x: cx + r * v * Math.cos(a), y: cy + r * v * Math.sin(a) };
  };
  const lp = (i: number) => {
    const a = (i * 2 * Math.PI / n) - Math.PI / 2;
    return { x: cx + (r + 16) * Math.cos(a), y: cy + (r + 16) * Math.sin(a) };
  };
  const ring = (v: number) => dims.map((_, i) => { const p = pt(i, v); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');
  const dataPts = dims.map((d, i) => { const p = pt(i, d.v); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');
  return (
    <svg viewBox="0 0 260 200" width="100%" style={{ display: 'block' }}>
      <polygon points={ring(1)}   fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      <polygon points={ring(0.5)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
      {dims.map((_, i) => { const p = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>; })}
      <polygon points={dataPts} fill="rgba(139,127,204,0.3)" stroke="#8B7FCC" strokeWidth="2"/>
      {dims.map((d, i) => { const p = pt(i, d.v); return <circle key={i} cx={p.x} cy={p.y} r="3" fill="#8B7FCC"/>; })}
      {dims.map((d, i) => { const p = lp(i); return <text key={i} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="rgba(255,255,255,0.5)" fontFamily="system-ui">{d.label}</text>; })}
    </svg>
  );
}

export default function YouScreen() {
  const nav = useNavigate();
  const s = useStore();
  const { tx, locale } = useI18n();
  const [showMilestones, setShowMilestones] = useState(false);
  const lvl = calcLevel(s.xp);
  const grantedPct = Math.round((Object.values(s.perms).filter(Boolean).length / Object.keys(s.perms).length) * 100);

  useEffect(() => {
    if (!s.token) return;
    api.getTodayFeed().then((data) => {
      if (data) s.setTodayFeed(data as Parameters<typeof s.setTodayFeed>[0]);
    });
    api.getHistory(7).then(data => {
      if (data) s.setHistory(data as Parameters<typeof s.setHistory>[0]);
    });
    api.getInsights(14).then(data => {
      if (data) s.setLongitudinal(data as Parameters<typeof s.setLongitudinal>[0]);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.token]);

  const profileBadges = useMemo(() => {
    return (s.todayFeed?.badges || []).map((badge) => {
      const meta = getBadgeMeta(badge.badgeId);
      return {
        ...badge,
        icon: meta.icon,
        title: meta.title,
        description: meta.description,
      };
    });
  }, [s.todayFeed?.badges]);

  const insights = s.longitudinal;
  const hasInsights = insights && (insights.insights.length > 0 || insights.patterns.length > 0 || insights.triggers.length > 0);
  const recentHistory = s.history.length > 0
    ? [...s.history]
        .sort((left, right) => String(left.date).localeCompare(String(right.date)))
        .slice(-7)
    : [];
  const wellbeingSeries = recentHistory.map((day: DayProfile, index) => ({
    label: day.date ? new Date(`${day.date}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' }) : (day.day_of_week?.slice(0, 2) || String(index + 1)),
    value: toNumber(day.composite_stress ?? day.stress_avg, 0),
    isToday: index === recentHistory.length - 1,
  }));
  const wellbeingAvg = wellbeingSeries.length > 0
    ? wellbeingSeries.reduce((sum, item) => sum + item.value, 0) / wellbeingSeries.length
    : 0;
  const wellbeingTrend = wellbeingSeries.length >= 2
    ? wellbeingSeries[wellbeingSeries.length - 1].value - wellbeingSeries[0].value
    : 0;
  const chartWidth = 312;
  const chartHeight = 124;
  const chartPaddingX = 14;
  const chartPaddingY = 14;
  const stepX = wellbeingSeries.length > 1 ? (chartWidth - chartPaddingX * 2) / (wellbeingSeries.length - 1) : 0;
  const toChartY = (value: number) => {
    const normalized = Math.max(0, Math.min(10, value)) / 10;
    return chartHeight - chartPaddingY - normalized * (chartHeight - chartPaddingY * 2);
  };
  const linePoints = wellbeingSeries.length > 0
    ? wellbeingSeries.map((item, index) => `${chartPaddingX + index * stepX},${toChartY(item.value)}`).join(' ')
    : '';
  const areaPoints = wellbeingSeries.length > 0
    ? [
        `${chartPaddingX},${chartHeight - chartPaddingY}`,
        linePoints,
        `${chartPaddingX + stepX * (wellbeingSeries.length - 1)},${chartHeight - chartPaddingY}`,
      ].join(' ')
    : '';
  const stability = Math.round(Math.max(0, (1 - wellbeingAvg / 10)) * 100);
  // Wellbeing score (0-100) for the arc
  const wbScore = Math.round(stability);
  const arcCircumference = 176; // 2*π*r ≈ 2*3.14159*28
  const arcOffset = arcCircumference - (wbScore / 100) * arcCircumference;
  const wbLabel = wbScore >= 75 ? 'Thriving' : wbScore >= 55 ? 'Holding steady' : wbScore >= 35 ? 'Finding balance' : 'Needs care';
  const stressLabel = wellbeingAvg >= 7 ? 'High' : wellbeingAvg >= 4 ? 'Moderate' : 'Low';
  const sleepLabel = s.sleep != null
    ? ['Great', 'Okay', 'Poor', 'Bad'][Math.max(0, Math.min(3, s.sleep))] || 'Okay'
    : 'Unknown';

  return (
    <div className="h-full overflow-y-auto scroll-area pb-6">

      {/* ── Profile hero ── */}
      <div className="bg-ink px-5 pb-5" style={{ paddingTop: 'max(env(safe-area-inset-top, 16px), 16px)' }}>
        <div className="flex items-start gap-3.5 mb-[18px]">
          <div className="relative flex-shrink-0">
            <div className="w-[60px] h-[60px] rounded-full flex items-center justify-center" style={{ background: s.avatarColor }}>
              <span className="font-fraunces text-2xl font-black italic text-ink">{(s.name || 'A')[0]}</span>
            </div>
            <div className="absolute bottom-[-2px] right-[-2px] w-5 h-5 rounded-full bg-bg border-2 border-ink flex items-center justify-center text-[10px] cursor-pointer">📷</div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-fraunces text-[22px] font-bold italic text-bg">{s.name || tx('there')}</h2>
              <button
                onClick={() => nav('/settings')}
                className="bg-[rgba(236,234,246,0.12)] border-none rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-[rgba(236,234,246,0.5)] cursor-pointer"
              >{tx('Edit')}</button>
              <button
                onClick={() => nav('/settings')}
                className="bg-[rgba(236,234,246,0.12)] border-none rounded-full w-[26px] h-[26px] flex items-center justify-center text-[13px] cursor-pointer"
              >⚙️</button>
            </div>
            <p className="text-xs text-[rgba(236,234,246,0.35)] mt-0.5">{tx(lvl.title)} · {tx('Finding my way')}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-[26px] font-extrabold text-warm">Lv.{lvl.level}</p>
            <p className="text-[9px] font-bold text-[rgba(236,234,246,0.25)] tracking-wider">{tx(lvl.title).toUpperCase()}</p>
          </div>
        </div>

        {/* XP bar */}
        <div className="mb-3.5">
          <div className="flex justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-[rgba(236,234,246,0.4)]">{tx('XP Progress')}</span>
            <span className="text-[11px] font-semibold text-[rgba(236,234,246,0.4)]">{s.xp} / {lvl.next} XP</span>
          </div>
          <ProgressBar pct={lvl.pct} />
          {lvl.level < LEVEL_TITLE.length && (
            <p className="text-[10px] text-[rgba(236,234,246,0.25)] mt-1 text-right">
              {lvl.next - s.xp} XP to Lv.{lvl.level + 1} {LEVEL_TITLE[lvl.level]}
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="flex gap-2">
          {[
            { v: `${s.streak}d`, l: tx('STREAK') },
            { v: `${stability}%`, l: tx('STABILITY') },
            { v: `${grantedPct}%`, l: tx('DATA ACCESS') },
          ].map((st, i) => (
            <div key={i} className="flex-1 bg-[rgba(236,234,246,0.07)] rounded-[14px] p-3 text-center">
              <p className="text-xl font-extrabold text-bg">{st.v}</p>
              <p className="text-[9px] font-bold text-[rgba(236,234,246,0.25)] tracking-wider mt-0.5">{st.l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Level Journey Path ── */}
      <div className="px-4 pt-5">
        <div className="flex items-center justify-between mb-2.5">
          <SectionLabel>{tx('Level Path')}</SectionLabel>
        </div>
        <div className="flex overflow-x-auto no-scrollbar pb-2 items-center">
          {LEVEL_TITLE.map((title, i) => {
            const lvNum = i + 1;
            const done = lvl.level > lvNum;
            const current = lvl.level === lvNum;
            const xpNeeded = LEVEL_XP[i];
            return (
              <div key={title} className="flex items-center flex-shrink-0">
                <div className="flex flex-col items-center w-[64px]">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-extrabold"
                    style={{
                      background: done ? '#8B7FCC' : current ? '#1C1830' : 'rgba(28,24,48,0.08)',
                      color: done || current ? 'white' : 'rgba(28,24,48,0.35)',
                      border: current ? '3px solid #C4527A' : '3px solid transparent',
                      boxShadow: current ? '0 0 0 3px rgba(196,82,122,0.2)' : 'none',
                    }}
                  >
                    {done ? '✓' : lvNum}
                  </div>
                  <p className="text-[9px] font-semibold text-center mt-1 leading-snug" style={{ color: current ? '#1C1830' : 'rgba(28,24,48,0.4)' }}>{tx(title)}</p>
                  <p className="text-[8px] mt-0.5" style={{ color: 'rgba(28,24,48,0.35)' }}>{xpNeeded} XP</p>
                </div>
                {i < LEVEL_TITLE.length - 1 && (
                  <div className="w-4 h-0.5 flex-shrink-0 mb-5" style={{ background: done ? '#8B7FCC' : 'rgba(28,24,48,0.1)' }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Badges ── */}
      <div className="pt-4 px-4">
        <div className="flex items-center justify-between mb-2.5">
          <SectionLabel>{tx('Badges')}</SectionLabel>
          <button onClick={() => setShowMilestones(true)} className="text-[11px] font-bold text-warm bg-transparent border-none cursor-pointer">{tx('See all →')}</button>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {profileBadges.length > 0 ? profileBadges.slice(0, 6).map((badge) => (
            <div
              key={badge.badgeId}
              className="flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2.5 rounded-[12px] border min-w-[64px]"
              style={{ background: 'rgba(28,24,48,0.04)', borderColor: 'rgba(28,24,48,0.08)' }}
            >
              <span className="text-[20px]">{badge.icon}</span>
              <p className="text-[9px] font-bold text-ink-3 text-center leading-snug max-w-[56px]">{tx(badge.title)}</p>
            </div>
          )) : (
            <p className="text-[12px] text-ink-4 py-3">{tx('Complete journeys to earn badges.')}</p>
          )}
        </div>
      </div>

      {/* ── Insights (real data) ── */}
      {hasInsights && (
        <div className="px-4 pt-4">
          <SectionLabel className="block mb-2.5">{tx("William's Insights")}</SectionLabel>
          <div className="space-y-2">
            {insights!.insights.map((ins, i) => (
              <div key={i} className={`rounded-2xl p-3.5 border-[1.5px] ${
                ins.type === 'warning' ? 'bg-rose-light border-rose/20' : 'bg-teal-light border-teal/20'
              }`}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-base">{ins.type === 'warning' ? '⚠️' : '✅'}</span>
                  <p className="text-sm font-bold text-ink">{tx(ins.title)}</p>
                </div>
                <p className="text-[12px] text-ink-3 leading-relaxed">{tx(ins.detail)}</p>
              </div>
            ))}
            {insights!.patterns.map((pat, i) => (
              <div key={i} className="rounded-2xl p-3.5 bg-bg-2 border-[1.5px] border-[rgba(80,70,160,0.1)]">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-base">📊</span>
                  <p className="text-sm font-bold text-ink">{tx('Weekly Pattern')}</p>
                </div>
                <p className="text-[12px] text-ink-3 leading-relaxed">{tx(pat.detail)}</p>
              </div>
            ))}
            {insights!.triggers.slice(0, 2).map((trig, i) => (
              <div key={i} className="rounded-2xl p-3.5 bg-gold-light border-[1.5px] border-gold/20">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-base">🔍</span>
                  <p className="text-sm font-bold text-ink">{tx('Trigger: "{trigger}"', { trigger: trig.trigger })}</p>
                </div>
                <p className="text-[12px] text-ink-3">{tx('Shows up on {count} high-stress days.', { count: trig.frequency })}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Wellbeing Hero ── */}
      <div className="px-4 pt-4 pb-2">
        <div className="rounded-[20px] p-5" style={{ background: 'linear-gradient(145deg, #1C1830, #342B5C)' }}>
          <p className="text-[10px] font-bold tracking-[0.1em] uppercase text-[rgba(255,255,255,0.5)] mb-3">{tx('YOUR WELLBEING')}</p>

          {/* Arc + label */}
          <div className="flex items-center gap-3.5 mb-4">
            <svg width="72" height="72" viewBox="0 0 72 72" className="flex-shrink-0">
              <circle cx="36" cy="36" r="28" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="7" />
              <circle
                cx="36" cy="36" r="28"
                fill="none" stroke="#8B7FCC" strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={arcCircumference}
                strokeDashoffset={arcOffset}
                transform="rotate(-90 36 36)"
                style={{ transition: 'stroke-dashoffset 0.8s' }}
              />
              <text x="36" y="42" textAnchor="middle" fontSize="17" fontWeight="800" fill="white" fontFamily="system-ui">{wbScore}</text>
            </svg>
            <div className="flex-1">
              <p className="font-fraunces text-[20px] font-bold italic text-white mb-1">{tx(wbLabel)}</p>
              <p className="text-[11px] text-[rgba(255,255,255,0.55)] leading-relaxed">{tx('Based on stress, sleep and mood this week.')}</p>
            </div>
          </div>

          {/* 4 stat tiles */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[
              { emoji: '😴', v: tx(sleepLabel), l: tx('Sleep') },
              { emoji: '💆', v: tx(stressLabel), l: tx('Stress') },
              { emoji: '🔥', v: `${s.streak}d`, l: tx('Streak') },
              { emoji: '⚡', v: String(s.xp), l: tx('XP') },
            ].map((tile) => (
              <div key={tile.l} className="bg-[rgba(255,255,255,0.07)] rounded-[10px] p-2.5 text-center">
                <span className="text-base block mb-0.5">{tile.emoji}</span>
                <p className="text-[13px] font-bold text-white">{tile.v}</p>
                <p className="text-[9px] text-[rgba(255,255,255,0.45)] mt-0.5">{tile.l}</p>
              </div>
            ))}
          </div>

          {/* Stress trend chart */}
          <div className="rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] px-3 py-3 mb-4">
            {wellbeingSeries.length === 0 ? (
              <div className="h-[124px] flex items-center justify-center">
                <p className="text-[12px] text-white/60">{tx('No wellbeing history yet.')}</p>
              </div>
            ) : (
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-[124px]" aria-label={tx('Average stress trend')}>
              <defs>
                <linearGradient id="wb2-line" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#C0B8E8" />
                  <stop offset="100%" stopColor="#C4527A" />
                </linearGradient>
                <linearGradient id="wb2-fill" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#C4527A" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#C4527A" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[2, 5, 8].map((tick) => (
                <line key={tick} x1={chartPaddingX} x2={chartWidth - chartPaddingX} y1={toChartY(tick)} y2={toChartY(tick)} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 6" />
              ))}
              <polygon points={areaPoints} fill="url(#wb2-fill)" />
              <polyline points={linePoints} fill="none" stroke="url(#wb2-line)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              {wellbeingSeries.map((point, index) => {
                const pcx = chartPaddingX + index * stepX;
                const pcy = toChartY(point.value);
                return (
                  <g key={point.label}>
                    <circle cx={pcx} cy={pcy} r={point.isToday ? 5 : 4} fill="#ECEAF6" />
                    <circle cx={pcx} cy={pcy} r={point.isToday ? 3 : 2.5} fill={point.value >= 6 ? '#C4527A' : point.value >= 4 ? '#B89020' : '#3A8880'} />
                  </g>
                );
              })}
            </svg>
            )}
            <div className="mt-2 flex items-center justify-between px-1">
              {wellbeingSeries.map((point) => (
                <div key={point.label} className="flex flex-col items-center gap-1 min-w-0">
                  <span className="text-[10px] text-[rgba(255,255,255,0.48)]">{tx(point.label)}</span>
                  <span className="text-[11px] font-semibold text-white/90">{point.value.toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Radar */}
          <p className="text-[11px] font-bold tracking-[0.06em] uppercase text-[rgba(255,255,255,0.5)] mb-2">{tx('Wellbeing Radar')}</p>
          <WellbeingRadar wellbeingAvg={wellbeingAvg} />

          <button
            onClick={() => nav('/chat', { state: { assistantPrompt: tx('I want to understand my overall wellbeing right now. Walk me through what you see in my stress, sleep, mood, and patterns — and tell me the one thing I should focus on improving first.') } })}
            className="mt-3.5 w-full py-3 bg-[rgba(255,255,255,0.1)] border border-[rgba(255,255,255,0.15)] rounded-[12px] text-white text-[13px] font-semibold cursor-pointer"
          >
            {tx('Talk to William about my wellbeing →')}
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 pb-6">
        <div
          className="rounded-[20px] p-[18px] relative overflow-hidden cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #1C1830, #2A1F4A)' }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(139,127,204,0.18),transparent_60%)]" />
          <div className="relative flex items-start gap-3.5 mb-3">
            <div className="w-[44px] h-[44px] rounded-[14px] bg-[rgba(139,127,204,0.2)] flex items-center justify-center flex-shrink-0">
              <span className="text-[22px]">🌿</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-fraunces text-base font-bold italic text-white">{tx('Tribe')}</span>
                <span className="bg-warm text-white text-[9px] font-extrabold px-2 py-0.5 rounded-full">{tx('COMING SOON')}</span>
              </div>
              <p className="text-[12px] text-[rgba(236,234,246,0.45)]">{tx('Connect with people who share your patterns')}</p>
            </div>
          </div>
          <div className="relative h-1.5 rounded-full bg-[rgba(255,255,255,0.08)]">
            <div className="h-full w-1/5 rounded-full" style={{ background: 'linear-gradient(90deg, #8B7FCC, #C4527A)' }} />
          </div>
          <div className="relative flex justify-between mt-1.5">
            {[tx('Joined'), tx('Setup'), tx('Matched'), tx('Connected'), tx('Tribe ready')].map((step, i) => (
              <span key={step} className="text-[8px] font-semibold" style={{ color: i === 0 ? '#8B7FCC' : 'rgba(236,234,246,0.25)' }}>{step}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Journey Wins Overlay ── */}
      {showMilestones && (
        <div className="fixed inset-0 z-50 flex flex-col bg-bg" style={{ maxWidth: 430, margin: '0 auto' }}>
          <div className="flex-shrink-0 flex items-center gap-3 px-5 py-4 border-b border-[rgba(80,70,160,0.08)]" style={{ paddingTop: 'max(env(safe-area-inset-top,16px),16px)' }}>
            <button onClick={() => setShowMilestones(false)} className="w-8 h-8 rounded-full bg-bg-2 flex items-center justify-center text-[18px] border-none cursor-pointer">←</button>
            <h2 className="font-fraunces text-[20px] font-bold italic text-ink">{tx('Badges')}</h2>
          </div>
          <div className="flex-1 overflow-y-auto scroll-area px-4 py-4">
            <p className="text-[13px] text-ink-3 mb-4">{tx('Recovery path completions you have already earned.')}</p>
            {profileBadges.length > 0 ? (
              <div className="grid grid-cols-2 gap-2.5">
                {profileBadges.map((badge) => (
                  <div key={badge.badgeId} className="rounded-2xl bg-white border border-[rgba(80,70,160,0.08)] p-3.5 shadow-card">
                    <span className="text-[28px] block mb-2">{badge.icon}</span>
                    <p className="text-[13px] font-bold text-ink leading-snug">{tx(badge.title)}</p>
                    <p className="text-[11px] text-ink-4 mt-1 leading-[1.5]">{tx(badge.description)}</p>
                    {badge.earnedAt && (
                      <p className="text-[10px] text-ink-4 mt-2 opacity-60">{new Date(badge.earnedAt).toLocaleDateString()}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-white/60 border border-[rgba(80,70,160,0.06)] px-4 py-10 text-center">
                <p className="text-[32px] mb-3">🏅</p>
                <p className="text-[14px] font-bold text-ink mb-1">{tx('No badges yet')}</p>
                <p className="text-[13px] text-ink-4 leading-6">{tx('Complete Journey paths to unlock your first badge.')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function getBadgeMeta(badgeId: EarnedBadge['badgeId']) {
  switch (badgeId) {
    case 'badge_conflict_reset':
      return {
        icon: '🤝',
        title: 'badge conflict reset',
        description: 'Earned by completing a relationship repair path.',
      };
    case 'badge_boundary_builder':
      return {
        icon: '🛡️',
        title: 'badge boundary builder',
        description: 'Earned by finishing a pressure-boundary recovery path.',
      };
    case 'badge_gentle_return':
      return {
        icon: '🌤️',
        title: 'badge gentle return',
        description: 'Earned by completing a gentle return path after loss.',
      };
    case 'badge_connection_rebuilder':
      return {
        icon: '🌱',
        title: 'badge connection rebuilder',
        description: 'Earned by rebuilding supportive connection over time.',
      };
    case 'badge_self_trust':
      return {
        icon: '🪞',
        title: 'badge self trust',
        description: 'Earned by rebuilding self-trust through steady action.',
      };
    default:
      return {
        icon: '🏅',
        title: badgeId.replace(/^badge_/, '').replace(/_/g, ' '),
        description: 'Earned by completing one of your recovery paths.',
      };
  }
}
