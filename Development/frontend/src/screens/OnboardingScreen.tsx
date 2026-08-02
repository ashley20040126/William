import { useState } from 'react';
import { useStore } from '@/services/store';
import * as api from '@/services/api';
import { CHALLENGES } from '@/utils/data';
import { Button, Pill, Toggle } from '@/components/ui';
import { useI18n } from '@/i18n/useI18n';

const SLEEP_OPTS = ['😴 Great', '😪 Okay', '🥱 Poor', '🌑 Bad'];
const WORK_OPTS = ['🏠 Remote', '🏢 Office', '🔀 Hybrid', '🎓 Student', '✨ Freelance'];
const PERM_ITEMS = [
  { k: 'mic', ico: '🎙️', label: 'Microphone', desc: 'Voice conversations' },
  { k: 'notifs', ico: '🔔', label: 'Notifications', desc: 'Check-ins & reminders' },
  { k: 'health', ico: '❤️', label: 'Health & Activity', desc: 'Steps, heart rate' },
  { k: 'calendar', ico: '📅', label: 'Calendar', desc: 'Schedule context' },
  { k: 'location', ico: '📍', label: 'Location', desc: 'Where you are' },
];

export default function OnboardingScreen() {
  const store = useStore();
  const { tx } = useI18n();
  const storedName = useStore((s) => s.name);
  const [step, setStep] = useState(1);
  const [age, setAge] = useState('');
  const [chals, setChals] = useState<number[]>([]);
  const [sleep, setSleep] = useState<number | null>(null);
  const [work, setWork] = useState<number | null>(null);

  const finish = () => {
    store.set({ age: parseInt(age), challenges: chals, sleep, work, onboarded: true, xp: 50, streak: 1, daysUsed: 1 });
    api.saveProfile({ name: storedName, age: parseInt(age), challenges: chals, sleep, work, onboarded: true });
  };

  const toggleChal = (i: number) => setChals(chals.includes(i) ? chals.filter(x => x !== i) : [...chals, i]);

  const ProgressDots = () => (
    <div className="flex gap-1 mb-7">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className={`flex-1 h-[3px] rounded-full ${i <= step ? 'bg-ink' : 'bg-bg-3'}`} />
      ))}
    </div>
  );

  const Back = ({ to }: { to: number }) => (
    <button onClick={() => setStep(to)} className="text-2xl text-ink-3 mb-5 bg-transparent border-none cursor-pointer">←</button>
  );

  // Step 1: Age
  if (step === 1) return (
    <div className="h-full flex flex-col bg-bg max-w-[430px] mx-auto">
      <div className="flex-1 overflow-y-auto px-6 pt-14">
        <ProgressDots />
        <h2 className="text-heading text-[28px] mb-1.5">
          {tx('Hi {name},', { name: storedName || tx('there') })}<br />{tx('how old are you?')}
        </h2>
        <p className="text-[13px] text-ink-3 mb-6">{tx('Helps William personalise your experience.')}</p>
        <input
          value={age} onChange={e => setAge(e.target.value.replace(/\D/g, '').slice(0, 2))}
          placeholder={tx('Your age')} type="tel"
          className="w-full bg-bg-2 border-[1.5px] border-[rgba(80,70,160,0.1)] rounded-[14px] p-4 text-[22px] font-bold italic text-ink outline-none focus:border-warm"
        />
      </div>
      <div className="p-6 pb-safe">
        <Button full disabled={!age || parseInt(age) < 13} onClick={() => setStep(2)}>{tx('Continue →')}</Button>
      </div>
    </div>
  );

  // Step 2: Challenges
  if (step === 2) return (
    <div className="h-full flex flex-col bg-bg max-w-[430px] mx-auto">
      <div className="flex-1 overflow-y-auto px-6 pt-14">
        <Back to={1} />
        <ProgressDots />
        <h2 className="text-heading text-[28px] mb-1.5">{tx('What brings you')}<br />{tx('to William?')}</h2>
        <p className="text-[13px] text-ink-3 mb-5">{tx('Select everything that rings true.')}</p>
        <div className="flex flex-wrap gap-2">
          {CHALLENGES.map((c, i) => (
            <Pill key={i} label={`${c.icon} ${tx(c.label)}`} selected={chals.includes(i)} onClick={() => toggleChal(i)} />
          ))}
        </div>
      </div>
      <div className="p-6 pb-safe">
        <Button full disabled={chals.length === 0} onClick={() => setStep(3)}>{tx('Continue →')}</Button>
      </div>
    </div>
  );

  // Step 3: Lifestyle
  if (step === 3) return (
    <div className="h-full flex flex-col bg-bg max-w-[430px] mx-auto">
      <div className="flex-1 overflow-y-auto px-6 pt-14">
        <Back to={2} />
        <ProgressDots />
        <h2 className="text-heading text-[28px] mb-1.5">{tx('Help William')}<br />{tx('understand your life')}</h2>
        <p className="text-[11px] font-bold text-ink-3 uppercase tracking-wider mt-4 mb-2.5">{tx('Sleep lately')}</p>
        <div className="flex flex-wrap gap-2 mb-5">
          {SLEEP_OPTS.map((l, i) => <Pill key={i} label={tx(l)} selected={sleep === i} onClick={() => setSleep(i)} />)}
        </div>
        <p className="text-[11px] font-bold text-ink-3 uppercase tracking-wider mb-2.5">{tx('Work situation')}</p>
        <div className="flex flex-wrap gap-2">
          {WORK_OPTS.map((l, i) => <Pill key={i} label={tx(l)} selected={work === i} onClick={() => setWork(i)} />)}
        </div>
      </div>
      <div className="p-6 pb-safe">
        <Button full onClick={() => setStep(4)}>{tx('Continue →')}</Button>
      </div>
    </div>
  );

  // Step 4: Permissions
  return (
    <div className="h-full flex flex-col bg-bg max-w-[430px] mx-auto">
      <div className="flex-1 overflow-y-auto px-6 pt-14">
        <Back to={3} />
        <ProgressDots />
        <h2 className="text-heading text-[28px] mb-1.5">{tx('Help William')}<br />{tx('know you better')}</h2>
        <p className="text-[13px] text-ink-3 mb-6">{tx('Grant what feels right — change anytime.')}</p>
        {PERM_ITEMS.map(p => (
          <button
            key={p.k} onClick={() => store.togglePerm(p.k)}
            className={`w-full flex items-center gap-3.5 p-4 bg-white rounded-2xl border-[1.5px] mb-2.5 text-left cursor-pointer
              ${store.perms[p.k] ? 'border-ink' : 'border-[rgba(80,70,160,0.1)]'}`}
          >
            <span className="text-2xl">{p.ico}</span>
            <span className="flex-1"><span className="block font-bold text-[15px]">{tx(p.label)}</span><span className="block text-xs text-ink-3 mt-0.5">{tx(p.desc)}</span></span>
            <Toggle on={store.perms[p.k]} onChange={() => store.togglePerm(p.k)} />
          </button>
        ))}
      </div>
      <div className="p-6 pb-safe flex flex-col gap-2.5">
        <Button variant="warm" full onClick={finish}>{tx('Begin your journey with William')}</Button>
        <button onClick={finish} className="text-[11px] text-[rgba(122,116,168,0.35)] bg-transparent border-none py-1.5 cursor-pointer">{tx('skip for now')}</button>
      </div>
    </div>
  );
}
