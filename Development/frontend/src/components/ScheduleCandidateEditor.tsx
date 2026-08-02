import { useEffect, useState } from 'react';
import { Overlay } from '@/components/ui';
import type { ScheduleCandidate } from '@/services/store';
import { useI18n } from '@/i18n/useI18n';

interface Props {
  candidate: ScheduleCandidate | null;
  open: boolean;
  saving?: boolean;
  onClose: () => void;
  onSave: (payload: {
    title: string;
    dateText: string;
    location: string;
    participants: string[];
  }) => Promise<void> | void;
}

export default function ScheduleCandidateEditor({
  candidate,
  open,
  saving = false,
  onClose,
  onSave,
}: Props) {
  const { tx } = useI18n();
  const [title, setTitle] = useState('');
  const [dateText, setDateText] = useState('');
  const [location, setLocation] = useState('');
  const [participants, setParticipants] = useState('');

  useEffect(() => {
    if (!candidate) return;
    setTitle(candidate.title || '');
    setDateText(candidate.dateText || candidate.startTime || '');
    setLocation(candidate.location || '');
    setParticipants((candidate.participants || []).join('，'));
  }, [candidate]);

  if (!candidate) return null;

  return (
    <Overlay open={open} onClose={onClose} variant="box">
      <p className="text-heading text-2xl mb-1">{tx('Edit plan')}</p>
      <p className="text-[13px] text-ink-3 mb-4">{tx('调整标题、时间表达、地点和参与人。V1 会根据时间文本重新解析具体时间。')}</p>

      <div className="space-y-3">
        <Field label={tx('Title')}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full bg-white border border-[rgba(80,70,160,0.12)] rounded-2xl px-3.5 py-3 text-sm text-ink outline-none"
            placeholder={tx('和老板聊离职')}
          />
        </Field>
        <Field label={tx('When')}>
          <input
            value={dateText}
            onChange={(event) => setDateText(event.target.value)}
            className="w-full bg-white border border-[rgba(80,70,160,0.12)] rounded-2xl px-3.5 py-3 text-sm text-ink outline-none"
            placeholder={tx('周五下午三点')}
          />
        </Field>
        <Field label={tx('Where')}>
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            className="w-full bg-white border border-[rgba(80,70,160,0.12)] rounded-2xl px-3.5 py-3 text-sm text-ink outline-none"
            placeholder={tx('公司会议室')}
          />
        </Field>
        <Field label={tx('Participants')}>
          <input
            value={participants}
            onChange={(event) => setParticipants(event.target.value)}
            className="w-full bg-white border border-[rgba(80,70,160,0.12)] rounded-2xl px-3.5 py-3 text-sm text-ink outline-none"
            placeholder={tx('老板，HR')}
          />
        </Field>
      </div>

      <div className="flex gap-2 mt-5">
        <button
          onClick={onClose}
          disabled={saving}
          className="flex-1 bg-bg-2 text-ink-3 rounded-xl py-3 text-sm font-semibold border border-[rgba(80,70,160,0.08)] disabled:opacity-50"
        >
          {tx('Cancel')}
        </button>
        <button
          onClick={() => onSave({
            title,
            dateText,
            location,
            participants: participants
              .split(/[,，、/]/)
              .map((item) => item.trim())
              .filter(Boolean),
          })}
          disabled={saving || !title.trim() || !dateText.trim()}
          className="flex-1 bg-ink text-bg rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
        >
          {saving ? tx('Saving…') : tx('Save')}
        </button>
      </div>
    </Overlay>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold text-ink-3 uppercase tracking-wider mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
