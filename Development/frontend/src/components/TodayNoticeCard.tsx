import { Card, SectionLabel } from '@/components/ui';
import { useI18n } from '@/i18n/useI18n';

type Props = {
  noticedText: string;
  badgeTone?: 'warning' | 'positive' | 'neutral';
  badgeLabel?: string | null;
  isTodaySelected: boolean;
  selectedDateLabel: string;
  onClick: () => void;
};

export default function TodayNoticeCard({
  noticedText,
  badgeTone = 'neutral',
  badgeLabel = null,
  isTodaySelected,
  selectedDateLabel,
  onClick,
}: Props) {
  const { tx } = useI18n();
  const resolvedBadgeLabel = badgeLabel || null;
  const badgeClassName = badgeTone === 'warning'
    ? 'bg-rose-light text-rose'
    : badgeTone === 'positive'
      ? 'bg-teal-light text-teal'
      : 'bg-bg-2 text-ink-3';

  return (
    <Card className="p-3.5 flex gap-2.5" onClick={onClick}>
      <div className="w-8 h-8 rounded-full bg-ink flex items-center justify-center flex-shrink-0">
        <span className="text-warm text-sm">◆</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <SectionLabel className="text-warm">{tx('William noticed')}</SectionLabel>
          {!isTodaySelected && (
            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-bg-2 text-ink-3">
              {selectedDateLabel}
            </span>
          )}
          {isTodaySelected && resolvedBadgeLabel && (
            <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ${badgeClassName}`}>
              {tx(resolvedBadgeLabel)}
            </span>
          )}
        </div>
        <p className="text-sm text-ink-2 leading-relaxed mt-0.5">{noticedText}</p>
        {isTodaySelected && (
          <p className="text-[11px] font-semibold text-[#3A67D6] mt-2">
            {tx('Ask William about this →')}
          </p>
        )}
      </div>
      <span className="text-ink-4">→</span>
    </Card>
  );
}
