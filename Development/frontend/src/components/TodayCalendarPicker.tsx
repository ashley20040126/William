import { DayPicker } from 'react-day-picker';
import { addMonths, format, setMonth, setYear } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Overlay } from '@/components/ui';
import { useI18n } from '@/i18n/useI18n';

interface Props {
  open: boolean;
  selected: Date;
  month: Date;
  minDate: Date;
  maxDate: Date;
  onClose: () => void;
  onSelect: (date: Date) => void;
  onMonthChange: (month: Date) => void;
}

export default function TodayCalendarPicker({
  open,
  selected,
  month,
  minDate,
  maxDate,
  onClose,
  onSelect,
  onMonthChange,
}: Props) {
  const { tx, dateFnsLocale } = useI18n();
  const monthOptions = Array.from({ length: 12 }, (_, index) => ({
    value: index,
    label: format(new Date(2026, index, 1), 'MMMM', { locale: dateFnsLocale }),
  }));
  const yearOptions = Array.from(
    { length: maxDate.getFullYear() - minDate.getFullYear() + 1 },
    (_, index) => minDate.getFullYear() + index
  );

  return (
    <Overlay open={open} onClose={onClose} variant="box">
      <div className="mb-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-4">{tx('Calendar')}</p>
        <p className="text-heading text-2xl text-ink mt-1">{format(month, 'MMMM yyyy', { locale: dateFnsLocale })}</p>
      </div>

      <div className="rounded-[22px] border border-[rgba(80,70,160,0.1)] bg-white px-3 py-3.5 shadow-card">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => onMonthChange(addMonths(month, -1))}
            className="w-9 h-9 rounded-full border border-[rgba(80,70,160,0.08)] bg-bg text-ink-3 flex items-center justify-center"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex-1 flex items-center gap-2">
            <select
              value={month.getMonth()}
              onChange={(event) => onMonthChange(setMonth(month, Number(event.target.value)))}
              className="flex-1 rounded-full border border-[rgba(80,70,160,0.1)] bg-bg px-3 py-2 text-sm font-semibold text-ink outline-none"
            >
              {monthOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              value={month.getFullYear()}
              onChange={(event) => onMonthChange(setYear(month, Number(event.target.value)))}
              className="w-[92px] rounded-full border border-[rgba(80,70,160,0.1)] bg-bg px-3 py-2 text-sm font-semibold text-ink outline-none"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => onMonthChange(addMonths(month, 1))}
            className="w-9 h-9 rounded-full border border-[rgba(80,70,160,0.08)] bg-bg text-ink-3 flex items-center justify-center"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <DayPicker
          mode="single"
          month={month}
          selected={selected}
          onMonthChange={onMonthChange}
          onSelect={(date) => {
            if (!date) return;
            onSelect(date);
          }}
          showOutsideDays={false}
          fixedWeeks={false}
          hideNavigation
          startMonth={new Date(minDate.getFullYear(), minDate.getMonth(), 1)}
          endMonth={new Date(maxDate.getFullYear(), maxDate.getMonth(), 1)}
          fromDate={minDate}
          toDate={maxDate}
          locale={dateFnsLocale}
          classNames={{
            root: 'rdp-root w-full',
            months: 'flex justify-center',
            month: 'space-y-2 w-full',
            weekdays: 'grid grid-cols-7 gap-1 mb-1',
            weekday: 'text-center text-[10px] font-bold uppercase text-ink-4',
            week: 'grid grid-cols-7 gap-1',
            day: 'flex justify-center',
            day_button: 'w-10 h-10 rounded-[16px] text-sm font-semibold text-ink transition-colors hover:bg-bg-2',
            today: 'border border-[rgba(196,82,122,0.22)] bg-warm-light text-warm',
            selected: 'bg-ink text-bg hover:bg-ink shadow-card',
            disabled: 'opacity-30',
          }}
        />
      </div>

      <button
        onClick={onClose}
        className="w-full mt-4 rounded-xl bg-bg-2 text-ink-3 py-3 text-sm font-semibold border border-[rgba(80,70,160,0.08)]"
      >
        {tx('Close')}
      </button>
    </Overlay>
  );
}
