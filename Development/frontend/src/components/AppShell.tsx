import { type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { haptic } from '@/hooks/useWebViewBridge';
import AmbientListeningController from '@/components/AmbientListeningController';
import { useI18n } from '@/i18n/useI18n';

const TABS = [
  { path: '/', icon: '☀️', label: 'Today' },
  { path: '/chat', icon: '💬', label: 'William' },
  { path: '/journey', icon: '🧭', label: 'Journey' },
  { path: '/you', icon: '🪬', label: 'You' },
] as const;

interface Props { children: ReactNode }

export default function AppShell({ children }: Props) {
  const nav = useNavigate();
  const loc = useLocation();
  const { tx } = useI18n();
  const isModal = loc.pathname.startsWith('/path/') || loc.pathname === '/mood' || loc.pathname === '/settings';

  return (
    <div className="h-full flex flex-col max-w-[430px] mx-auto bg-bg relative overflow-hidden shadow-2xl">
      {/* Main content */}
      <main className="flex-1 overflow-hidden relative">
        <AmbientListeningController />
        {children}
      </main>

      {/* Bottom tab bar */}
      {!isModal && (
        <nav
          className="flex-shrink-0 flex items-center justify-around bg-[rgba(246,245,252,0.97)] backdrop-blur-md border-t border-[rgba(80,70,160,0.1)]"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 12px), 12px)', paddingTop: 6 }}
        >
          {TABS.map(({ path, icon, label }) => {
            const active = loc.pathname === path;
            return (
              <button
                key={path}
                onClick={() => { haptic('light'); nav(path); }}
                className="flex flex-col items-center gap-0.5 py-1 px-3 bg-transparent border-none cursor-pointer"
              >
                <span
                  className={clsx('text-[22px] transition-transform', active && 'scale-115')}
                  style={{ transform: active ? 'scale(1.15)' : 'scale(1)' }}
                >
                  {icon}
                </span>
                <span className={clsx(
                  'text-[9px] font-semibold uppercase tracking-wide',
                  active ? 'text-ink-2' : 'text-ink-4'
                )}>
                  {tx(label)}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
