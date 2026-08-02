import { useState } from 'react';
import { Wind, ArrowRightLeft, NotebookPen, Sparkles, Music } from 'lucide-react';
import { Card } from '@/components/ui';
import type { JourneySkill } from '@/services/journeyApi';

// Map backend skill types to display categories
const TYPE_CATEGORY: Record<string, string> = {
  regulation:      '生理',
  boundary:        '行为',
  reflection:      '认知',
  deep_reflection: '认知',
  maintenance:     '生理',
  audio:           '音频',
};

const CATEGORY_ICON: Record<string, typeof Wind> = {
  生理: Wind,
  认知: NotebookPen,
  行为: ArrowRightLeft,
  音频: Music,
};

const SKILL_ACCENT: Record<string, { tone: [string, string] }> = {
  regulation:      { tone: ['#D85874', '#F19A7A'] },
  boundary:        { tone: ['#4367A8', '#6D8EC8'] },
  reflection:      { tone: ['#6B4CA0', '#B57BD6'] },
  deep_reflection: { tone: ['#7C5A2C', '#D9A84F'] },
  maintenance:     { tone: ['#2E7D73', '#69B6A5'] },
  audio:           { tone: ['#1C4A7A', '#3A8FD0'] },
};

const CATEGORIES = ['全部', '生理', '认知', '行为', '音频'];

interface Props {
  skills: JourneySkill[];
}

export default function Toolkit({ skills }: Props) {
  const [activeCategory, setActiveCategory] = useState('全部');

  const displayed = activeCategory === '全部'
    ? skills
    : skills.filter((s) => (TYPE_CATEGORY[s.type] ?? '生理') === activeCategory);

  return (
    <div>
      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 mb-3">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`flex-none rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-all ${
              activeCategory === cat
                ? 'bg-ink text-bg'
                : 'bg-white/90 text-ink-3 border border-[rgba(80,70,160,0.10)]'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Skill cards */}
      {displayed.length === 0 ? (
        <div className="rounded-2xl bg-white/60 border border-[rgba(80,70,160,0.06)] px-4 py-6 text-center">
          <p className="text-[13px] text-ink-4">该分类暂无技能，先完成更多练习来解锁。</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {displayed.map((skill) => (
            <SkillCard key={skill.id} skill={skill} />
          ))}
        </div>
      )}
    </div>
  );
}

function SkillCard({ skill }: { skill: JourneySkill }) {
  const [expanded, setExpanded] = useState(false);
  const accent = SKILL_ACCENT[skill.type] ?? SKILL_ACCENT.maintenance;
  const category = TYPE_CATEGORY[skill.type] ?? '生理';
  const Icon = CATEGORY_ICON[category] ?? Sparkles;

  return (
    <Card className="overflow-hidden bg-white/95">
      <div
        className="h-1.5"
        style={{ background: `linear-gradient(to right, ${accent.tone[0]}, ${accent.tone[1]})` }}
      />
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full p-4 text-left"
      >
        <div className="flex items-start gap-3">
          <div
            className="mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-xl text-white"
            style={{ background: `linear-gradient(135deg, ${accent.tone[0]}, ${accent.tone[1]})` }}
          >
            <Icon size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[14px] font-bold text-ink leading-snug">{skill.title}</p>
              <span className="flex-none rounded-full bg-bg px-2 py-0.5 text-[10px] font-bold text-ink-4 border border-[rgba(80,70,160,0.08)]">
                {category}
              </span>
            </div>
            {skill.cadence && (
              <p className="text-[11px] text-ink-4 mt-0.5">{skill.cadence}</p>
            )}
          </div>
        </div>

        {expanded && (
          <div className="mt-3 space-y-2.5">
            {skill.reason && (
              <p className="text-[13px] leading-6 text-ink-2">{skill.reason}</p>
            )}
            {skill.trigger && (
              <div className="rounded-xl bg-[rgba(248,246,252,0.92)] px-3 py-2.5 border border-[rgba(80,70,160,0.06)]">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-4">适用场景</p>
                <p className="text-[12px] leading-6 text-ink mt-1">{skill.trigger}</p>
              </div>
            )}
            {skill.steps.length > 0 && (
              <div className="space-y-1.5">
                {skill.steps.map((step, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="mt-[1px] flex-none w-5 h-5 rounded-full bg-ink flex items-center justify-center text-[10px] font-bold text-bg">
                      {i + 1}
                    </span>
                    <p className="flex-1 text-[12px] leading-6 text-ink-2">{step}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </button>
    </Card>
  );
}
