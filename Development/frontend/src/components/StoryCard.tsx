import { useState } from 'react';
import { format } from 'date-fns';
import type { DailyStory, StoryPanel } from '@/services/journeyApi';
import { useI18n } from '@/i18n/useI18n';
import { resolveAssetUrl } from '@/services/http';

const PANEL_STYLE: Record<string, { bg: string; border: string; accent: string; emoji: string }> = {
  trigger:    { bg: 'bg-[#FFF7F0]', border: 'border-[rgba(216,88,116,0.15)]', accent: '#D85874', emoji: '⚡' },
  state:      { bg: 'bg-[#F8F3FF]', border: 'border-[rgba(107,76,160,0.15)]', accent: '#8B7FCC', emoji: '💫' },
  action:     { bg: 'bg-[#F0F9F7]', border: 'border-[rgba(46,125,115,0.15)]', accent: '#2E7D73', emoji: '🛠' },
  resolution: { bg: 'bg-[#FFFDF0]', border: 'border-[rgba(217,168,79,0.15)]', accent: '#B89020', emoji: '🌱' },
};

interface Props {
  story: DailyStory;
  /** display date label using this locale */
  dateLabel?: string;
}

export default function StoryCard({ story, dateLabel }: Props) {
  const [expandedPanel, setExpandedPanel] = useState<string | null>(null);
  const { tx } = useI18n();
  const label = dateLabel ?? formatDateLabel(story.date);

  return (
    <div className="rounded-3xl bg-white/96 border border-[rgba(80,70,160,0.08)] shadow-card overflow-hidden">
      {/* Date header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-4">{label}</p>
        <span className="text-[10px] text-ink-4 opacity-60">{tx('4-panel story')}</span>
      </div>

      {/* 2×2 Grid */}
      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        {story.panels.map((panel) => (
          <PanelCell
            key={panel.type}
            panel={panel}
            tx={tx}
            isExpanded={expandedPanel === panel.type}
            onToggle={() =>
              setExpandedPanel((prev) => (prev === panel.type ? null : panel.type))
            }
          />
        ))}
      </div>
    </div>
  );
}

function PanelCell({
  panel,
  tx,
  isExpanded,
  onToggle,
}: {
  panel: StoryPanel;
  tx: (key: string, vars?: Record<string, string | number>) => string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const style = PANEL_STYLE[panel.type] ?? PANEL_STYLE.resolution;
  const missingApiKey = panel.image_fallback_reason === 'missing_api_key';
  const quotaFallback = panel.image_fallback_reason === 'quota_exceeded';
  const showFallbackArtwork = missingApiKey || quotaFallback;

  return (
    <button
      onClick={onToggle}
      className={`text-left rounded-2xl border overflow-hidden transition-all ${style.border} ${
        isExpanded ? 'col-span-2' : ''
      }`}
    >
      {panel.image_url ? (
        <img
          src={resolveAssetUrl(panel.image_url)}
          alt={panel.title}
          className="w-full aspect-square object-cover"
          loading="lazy"
        />
      ) : (
        <div className={`relative flex flex-col items-center justify-end gap-2 aspect-square px-3 py-3 overflow-hidden ${style.bg}`}>
          {showFallbackArtwork ? (
            <QuotaFallbackArtwork panelType={panel.type} accent={style.accent} />
          ) : (
            <span className="text-[36px] mb-8">{style.emoji}</span>
          )}
          {showFallbackArtwork && (
            <div className="relative z-[1] text-center rounded-2xl bg-white/72 backdrop-blur-sm px-3 py-2 border border-white/70 shadow-[0_8px_20px_rgba(80,70,160,0.08)]">
              <p className="text-[11px] font-semibold text-ink">
                {missingApiKey ? tx('AI comics are off') : tx('Image unavailable')}
              </p>
              <p className="text-[10px] leading-[1.45] text-ink-4">
                {missingApiKey
                  ? tx('Add your OpenAI API key in Settings to enable AI comic images. Until then, William shows the default fallback artwork.')
                  : tx('Image generation is temporarily unavailable because the current image model quota is exhausted.')}
              </p>
            </div>
          )}
        </div>
      )}
      <div className={`p-2.5 ${style.bg}`}>
        <p
          className="text-[10px] font-bold uppercase tracking-[0.12em] mb-1"
          style={{ color: style.accent }}
        >
          {panel.title}
        </p>
        <p className="text-[11px] leading-[1.55] text-ink-2">{panel.text}</p>
        {isExpanded && panel.signal_source && (
          <p className="mt-2 text-[10px] text-ink-4 border-t border-[rgba(80,70,160,0.06)] pt-2">
            {tx('Signal source')}: {tx(SOURCE_LABEL[panel.signal_source] ?? panel.signal_source)}
          </p>
        )}
      </div>
    </button>
  );
}

function QuotaFallbackArtwork({
  panelType,
  accent,
}: {
  panelType: StoryPanel['type'];
  accent: string;
}) {
  const scene = QUOTA_FALLBACK_SCENE[panelType] ?? QUOTA_FALLBACK_SCENE.resolution;

  return (
    <div className="absolute inset-0">
      <div
        className="absolute inset-0 opacity-95"
        style={{
          background: scene.background,
        }}
      />
      <div
        className="absolute -top-8 -right-6 h-28 w-28 rounded-full blur-2xl opacity-60"
        style={{ backgroundColor: `${accent}33` }}
      />
      <div
        className="absolute bottom-6 left-4 right-4 top-5 rounded-[28px] border border-white/35 overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
        style={{ background: scene.frame }}
      >
        <div
          className="absolute inset-x-0 top-0 h-[42%]"
          style={{ background: scene.sky }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-[38%]"
          style={{ background: scene.ground }}
        />
        <div
          className="absolute left-1/2 top-[56%] h-[28%] w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-[999px_999px_320px_320px]"
          style={{ background: scene.figure }}
        />
        <div
          className="absolute left-1/2 top-[38%] h-[14%] w-[14%] -translate-x-1/2 rounded-full"
          style={{ background: scene.head }}
        />
        <div
          className="absolute h-[16%] w-[16%] rounded-full blur-[1px] opacity-80"
          style={{
            background: scene.orb,
            left: scene.orbPosition.left,
            top: scene.orbPosition.top,
          }}
        />
        <div
          className="absolute h-[18%] w-[34%] rounded-full blur-lg opacity-40"
          style={{
            background: `${accent}55`,
            left: scene.glowPosition.left,
            top: scene.glowPosition.top,
          }}
        />
      </div>
      <div className="absolute inset-x-5 top-4 flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.14em] text-white/70">
        <span>{scene.label}</span>
        <span>{scene.seed}</span>
      </div>
    </div>
  );
}

const QUOTA_FALLBACK_SCENE: Record<
  StoryPanel['type'],
  {
    label: string;
    seed: string;
    background: string;
    frame: string;
    sky: string;
    ground: string;
    figure: string;
    head: string;
    orb: string;
    orbPosition: { left: string; top: string };
    glowPosition: { left: string; top: string };
  }
> = {
  trigger: {
    label: 'AIGC Draft',
    seed: 'seed 042',
    background: 'linear-gradient(180deg, #FFE7DA 0%, #FFD0D8 50%, #FFF6F1 100%)',
    frame: 'linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,244,240,0.82) 100%)',
    sky: 'linear-gradient(180deg, #FFCFC2 0%, #FFE5D6 100%)',
    ground: 'linear-gradient(180deg, #F6B7A3 0%, #E88F86 100%)',
    figure: 'linear-gradient(180deg, #7C4750 0%, #A65E67 100%)',
    head: '#FCE7D8',
    orb: 'radial-gradient(circle, rgba(255,255,255,0.96) 0%, rgba(255,232,196,0.2) 70%)',
    orbPosition: { left: '18%', top: '18%' },
    glowPosition: { left: '56%', top: '18%' },
  },
  state: {
    label: 'AIGC Draft',
    seed: 'seed 188',
    background: 'linear-gradient(180deg, #E9E0FF 0%, #D6CCFF 52%, #F8F4FF 100%)',
    frame: 'linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(242,236,255,0.85) 100%)',
    sky: 'linear-gradient(180deg, #CBBEFF 0%, #E7E0FF 100%)',
    ground: 'linear-gradient(180deg, #A18AD7 0%, #7763B8 100%)',
    figure: 'linear-gradient(180deg, #4D3C75 0%, #6D56A4 100%)',
    head: '#F4E9F8',
    orb: 'radial-gradient(circle, rgba(245,250,255,0.96) 0%, rgba(197,202,255,0.25) 74%)',
    orbPosition: { left: '66%', top: '14%' },
    glowPosition: { left: '8%', top: '24%' },
  },
  action: {
    label: 'AIGC Draft',
    seed: 'seed 321',
    background: 'linear-gradient(180deg, #DDF7EF 0%, #C8F1E4 55%, #F4FFFB 100%)',
    frame: 'linear-gradient(180deg, rgba(255,255,255,0.48) 0%, rgba(233,252,246,0.84) 100%)',
    sky: 'linear-gradient(180deg, #B9EEDC 0%, #E5FFF8 100%)',
    ground: 'linear-gradient(180deg, #6DC5AC 0%, #4A9E8A 100%)',
    figure: 'linear-gradient(180deg, #35695B 0%, #4B907C 100%)',
    head: '#EAF6EF',
    orb: 'radial-gradient(circle, rgba(255,251,219,0.96) 0%, rgba(255,244,194,0.22) 74%)',
    orbPosition: { left: '24%', top: '16%' },
    glowPosition: { left: '56%', top: '14%' },
  },
  resolution: {
    label: 'AIGC Draft',
    seed: 'seed 507',
    background: 'linear-gradient(180deg, #FFF5D8 0%, #FFF0B8 54%, #FFFDF2 100%)',
    frame: 'linear-gradient(180deg, rgba(255,255,255,0.52) 0%, rgba(255,250,226,0.85) 100%)',
    sky: 'linear-gradient(180deg, #FFE79A 0%, #FFF6D1 100%)',
    ground: 'linear-gradient(180deg, #E3C978 0%, #C39A45 100%)',
    figure: 'linear-gradient(180deg, #6B5A2A 0%, #8B733A 100%)',
    head: '#FFF5D9',
    orb: 'radial-gradient(circle, rgba(255,255,255,0.98) 0%, rgba(255,242,174,0.24) 74%)',
    orbPosition: { left: '64%', top: '16%' },
    glowPosition: { left: '10%', top: '20%' },
  },
};

const SOURCE_LABEL: Record<string, string> = {
  calendar:            'Calendar event',
  chat:                'William chat',
  day_profile:         'Daily behavior profile',
  practice_completions:'Completed practices',
  ambient_listening:   'Ambient listening',
  william:             'William inference',
};

function formatDateLabel(dateKey: string): string {
  try {
    return format(new Date(`${dateKey}T12:00:00`), 'M月d日 EEEE');
  } catch {
    return dateKey;
  }
}
