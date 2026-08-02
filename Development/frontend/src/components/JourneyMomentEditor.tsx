import { useEffect, useState } from 'react';
import { Overlay } from '@/components/ui';
import type { ScheduleCandidate } from '@/services/store';
import { useI18n } from '@/i18n/useI18n';

type DefaultMomentPayload = {
  type: 'default';
  key: string;
  time: string;
  place: string;
  event: string;
  stress: number;
};

type ScheduleMomentPayload = {
  type: 'schedule';
  candidate: ScheduleCandidate;
  title: string;
  dateText: string;
  location: string;
  notes: string;
};

export type JourneyMomentEditorPayload = DefaultMomentPayload | ScheduleMomentPayload;

interface Props {
  open: boolean;
  value: JourneyMomentEditorPayload | null;
  saving?: boolean;
  deleting?: boolean;
  onClose: () => void;
  onSave: (payload: JourneyMomentEditorPayload) => Promise<void> | void;
  onDelete: (payload: JourneyMomentEditorPayload) => Promise<void> | void;
}

export default function JourneyMomentEditor({
  open,
  value,
  saving = false,
  deleting = false,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const { tx } = useI18n();
  const [time, setTime] = useState('');
  const [place, setPlace] = useState('');
  const [event, setEvent] = useState('');
  const [stress, setStress] = useState('5');
  const [dateText, setDateText] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!value) return;
    if (value.type === 'default') {
      setTime(value.time);
      setPlace(value.place);
      setEvent(value.event);
      setStress(String(value.stress));
      setDateText('');
      setNotes('');
      return;
    }
    setEvent(value.title);
    setDateText(value.dateText);
    setPlace(value.location);
    setNotes(value.notes || '');
    setTime('');
    setStress('5');
  }, [value]);

  if (!value) return null;

  const isSchedule = value.type === 'schedule';

  return (
    <Overlay open={open} onClose={onClose} variant="box">
      <p className="text-heading text-2xl mb-1">{tx('Edit moment')}</p>
      <p className="text-[13px] text-ink-3 mb-4">
        {isSchedule ? tx('修改后会同步更新 Journey 日程。删除也在这里完成。') : tx('修改当前 moment 的时间、地点、事件和压力。删除也在这里完成。')}
      </p>

      <div className="space-y-3">
        {isSchedule ? (
          <>
            <Field label={tx('Event')}>
              <input
                value={event}
                onChange={(e) => setEvent(e.target.value)}
                className="w-full bg-white border border-[rgba(80,70,160,0.12)] rounded-2xl px-3.5 py-3 text-sm text-ink outline-none"
                placeholder={tx('喝咖啡')}
              />
            </Field>
            <Field label={tx('When')}>
              <input
                value={dateText}
                onChange={(e) => setDateText(e.target.value)}
                className="w-full bg-white border border-[rgba(80,70,160,0.12)] rounded-2xl px-3.5 py-3 text-sm text-ink outline-none"
                placeholder={tx('今天早上8-9')}
              />
            </Field>
            <Field label={tx('Where')}>
              <input
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                className="w-full bg-white border border-[rgba(80,70,160,0.12)] rounded-2xl px-3.5 py-3 text-sm text-ink outline-none"
                placeholder={tx('咖啡馆')}
              />
            </Field>
            <Field label={tx('Notes')}>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-white border border-[rgba(80,70,160,0.12)] rounded-2xl px-3.5 py-3 text-sm text-ink outline-none"
                placeholder={tx('Optional note')}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label={tx('Time')}>
              <input
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full bg-white border border-[rgba(80,70,160,0.12)] rounded-2xl px-3.5 py-3 text-sm text-ink outline-none"
                placeholder={tx('8-9am')}
              />
            </Field>
            <Field label={tx('Place')}>
              <input
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                className="w-full bg-white border border-[rgba(80,70,160,0.12)] rounded-2xl px-3.5 py-3 text-sm text-ink outline-none"
                placeholder={tx('咖啡馆')}
              />
            </Field>
            <Field label={tx('Event')}>
              <input
                value={event}
                onChange={(e) => setEvent(e.target.value)}
                className="w-full bg-white border border-[rgba(80,70,160,0.12)] rounded-2xl px-3.5 py-3 text-sm text-ink outline-none"
                placeholder={tx('喝咖啡')}
              />
            </Field>
            <Field label={tx('Stress')}>
              <input
                type="number"
                min={0}
                max={10}
                value={stress}
                onChange={(e) => setStress(e.target.value)}
                className="w-full bg-white border border-[rgba(80,70,160,0.12)] rounded-2xl px-3.5 py-3 text-sm text-ink outline-none"
                placeholder="5"
              />
            </Field>
          </>
        )}
      </div>

      <div className="flex gap-2 mt-5">
        <button
          onClick={onClose}
          disabled={saving || deleting}
          className="flex-1 bg-bg-2 text-ink-3 rounded-xl py-3 text-sm font-semibold border border-[rgba(80,70,160,0.08)] disabled:opacity-50"
        >
          {tx('Cancel')}
        </button>
        <button
          onClick={() => onDelete(value)}
          disabled={saving || deleting}
          className="flex-1 bg-white text-rose rounded-xl py-3 text-sm font-semibold border border-[rgba(196,82,122,0.18)] disabled:opacity-50"
        >
          {deleting ? tx('Deleting…') : tx('Delete')}
        </button>
        <button
          onClick={() => {
            if (value.type === 'schedule') {
              onSave({
                type: 'schedule',
                candidate: value.candidate,
                title: event,
                dateText,
                location: place,
                notes,
              });
              return;
            }
            onSave({
              type: 'default',
              key: value.key,
              time,
              place,
              event,
              stress: Number(stress) || 0,
            });
          }}
          disabled={
            saving ||
            deleting ||
            (isSchedule ? !event.trim() || !dateText.trim() : !time.trim() || !place.trim() || !event.trim())
          }
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
