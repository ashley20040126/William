import { Card, SectionLabel } from '@/components/ui';
import { useI18n } from '@/i18n/useI18n';
import type { ScheduleCandidate } from '@/services/store';

type Props = {
  scheduleCandidates: ScheduleCandidate[];
  scheduleBusyId: number | null;
  onConfirm: (candidateId: number) => void;
  onEdit: (candidate: ScheduleCandidate) => void;
  formatSchedulePrimary: (candidate: ScheduleCandidate) => string;
  readCandidateNotes: (candidate: ScheduleCandidate) => string;
};

export default function WilliamPlansCard({
  scheduleCandidates,
  scheduleBusyId,
  onConfirm,
  onEdit,
  formatSchedulePrimary,
  readCandidateNotes,
}: Props) {
  const { tx } = useI18n();

  if (!scheduleCandidates.length) return null;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <SectionLabel>{tx('Planned From William')}</SectionLabel>
          <p className="text-[15px] font-bold text-ink">{tx('Detected from recent chat')}</p>
        </div>
        <span className="text-[11px] font-semibold text-ink-4">
          {scheduleCandidates.length} {tx('pending')}
        </span>
      </div>
      <div className="space-y-2.5">
        {scheduleCandidates.map((candidate) => (
          <div key={candidate.id} className="rounded-2xl border border-[rgba(80,70,160,0.1)] bg-white px-3.5 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink leading-snug">{candidate.title}</p>
                <p className="text-[11px] text-ink-4 mt-1">{formatSchedulePrimary(candidate)}</p>
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
                onClick={() => onConfirm(candidate.id)}
                disabled={scheduleBusyId === candidate.id}
                className="flex-1 bg-ink text-bg text-[11px] font-bold px-3 py-2 rounded-xl border-none disabled:opacity-50"
              >
                {tx('Add to Journey')}
              </button>
              <button
                onClick={() => onEdit(candidate)}
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
  );
}
