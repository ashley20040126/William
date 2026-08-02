import { type ReactNode, type ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import type { VoiceDef } from '@/utils/data';

// ── Button ──
type BtnVariant = 'dark' | 'warm' | 'ghost' | 'pill';
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  full?: boolean;
}
const btnStyles: Record<BtnVariant, string> = {
  dark: 'bg-ink text-bg hover:opacity-90',
  warm: 'bg-warm text-white hover:opacity-90',
  ghost: 'bg-transparent text-ink-3',
  pill: 'bg-bg-2 border border-[rgba(80,70,160,0.18)] text-ink-2 text-[13px]',
};
export function Button({ variant = 'dark', full, className, children, ...props }: BtnProps) {
  return (
    <button
      className={clsx(
        'rounded-full font-semibold text-sm py-3.5 px-5 transition-all active:scale-[0.96] disabled:opacity-30',
        btnStyles[variant], full && 'w-full', className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ── Card ──
interface CardProps { children: ReactNode; className?: string; onClick?: () => void }
export function Card({ children, className, onClick }: CardProps) {
  return (
    <motion.div
      whileTap={onClick ? { scale: 0.98 } : undefined}
      onClick={onClick}
      className={clsx('bg-white rounded-2xl border border-[rgba(80,70,160,0.1)] shadow-card', onClick && 'cursor-pointer', className)}
    >
      {children}
    </motion.div>
  );
}

// ── Pill (selectable tag) ──
interface PillProps { label: string; selected?: boolean; onClick: () => void }
export function Pill({ label, selected, onClick }: PillProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-full px-3.5 py-2 text-[13px] font-semibold border-[1.5px] transition-all',
        selected ? 'bg-ink text-bg border-ink' : 'bg-bg-2 text-ink-2 border-[rgba(80,70,160,0.18)]'
      )}
    >
      {label}
    </button>
  );
}

// ── Toggle ──
interface ToggleProps { on: boolean; onChange: () => void }
export function Toggle({ on, onChange }: ToggleProps) {
  return (
    <button onClick={onChange} className={clsx('w-11 h-[26px] rounded-full transition-colors relative', on ? 'bg-teal' : 'bg-bg-3')}>
      <span className={clsx('absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-[left]', on ? 'left-[21px]' : 'left-[3px]')} />
    </button>
  );
}

// ── Progress Bar ──
interface ProgressProps { pct: number; gradient?: [string, string]; trackColor?: string; className?: string }
export function ProgressBar({ pct, gradient = ['#8B7FCC', '#C4527A'], trackColor, className }: ProgressProps) {
  return (
    <div
      className={clsx('h-1.5 rounded-full overflow-hidden', className)}
      style={{ background: trackColor ?? 'rgba(236,234,246,0.12)' }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, pct)}%`, background: `linear-gradient(90deg, ${gradient[0]}, ${gradient[1]})` }}
      />
    </div>
  );
}

// ── Section Label ──
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx('text-[11px] font-bold text-ink-3 uppercase tracking-wider', className)}>
      {children}
    </span>
  );
}

// ── Stress Tag ──
export function StressTag({ value }: { value: number }) {
  const color = value >= 8 ? 'bg-rose-light text-rose' : value >= 5 ? 'bg-gold-light text-gold' : 'bg-teal-light text-teal';
  return <span className={clsx('text-[10px] font-extrabold px-2 py-0.5 rounded-full', color)}>{value}/10</span>;
}

// ── Model Avatar ──
type ModelAvatarSize = 'pill' | 'sm' | 'md';
type ModelAvatarRounded = 'md' | 'xl' | 'full';

const avatarSizeStyles: Record<ModelAvatarSize, string> = {
  pill: 'w-[22px] h-[22px] text-[11px]',
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-10 h-10 text-lg',
};

const avatarBadgeStyles: Record<ModelAvatarSize, string> = {
  pill: 'w-2.5 h-2.5 text-[7px] -top-0.5 -right-0.5',
  sm: 'w-3 h-3 text-[8px] -top-0.5 -right-0.5',
  md: 'w-3.5 h-3.5 text-[9px] -top-1 -right-1',
};

const avatarRoundedStyles: Record<ModelAvatarRounded, string> = {
  md: 'rounded-md',
  xl: 'rounded-xl',
  full: 'rounded-full',
};

export function ModelAvatar({
  voice,
  size = 'md',
  rounded = 'full',
  className,
}: {
  voice: VoiceDef;
  size?: ModelAvatarSize;
  rounded?: ModelAvatarRounded;
  className?: string;
}) {
  const roundedClass = avatarRoundedStyles[rounded];

  return (
    <div
      className={clsx(
        'relative isolate inline-flex items-center justify-center overflow-hidden text-white flex-shrink-0',
        avatarSizeStyles[size],
        roundedClass,
        className
      )}
      style={{ background: voice.avatar.gradient, boxShadow: voice.avatar.shadow }}
      aria-hidden="true"
    >
      <span className={clsx('absolute inset-[1px] border border-white/18', roundedClass)} />
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.36),transparent_45%)]" />
      <span className="relative z-10 font-black leading-none tracking-[-0.04em]">{voice.avatar.glyph}</span>
      <span
        className={clsx(
          'absolute z-10 inline-flex items-center justify-center rounded-full bg-[rgba(21,18,36,0.22)] text-white/90 font-black border border-white/20',
          avatarBadgeStyles[size]
        )}
      >
        {voice.avatar.badge}
      </span>
    </div>
  );
}

// ── Overlays (Sheet & Box) ──
interface OverlayProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  variant?: 'sheet' | 'box';
}

export function Overlay({ open, onClose, children, variant = 'sheet' }: OverlayProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[800] bg-[rgba(28,24,48,0.45)] backdrop-blur-sm flex justify-center items-end overflow-hidden"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <AnimatePresence>
        <motion.div
          initial={variant === 'sheet' ? { y: '100%' } : { scale: 0.92, opacity: 0 }}
          animate={variant === 'sheet' ? { y: 0 } : { scale: 1, opacity: 1 }}
          exit={variant === 'sheet' ? { y: '100%' } : { scale: 0.92, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className={clsx(
            'bg-bg overflow-y-auto max-h-[88vh] border-[rgba(80,70,160,0.1)]',
            variant === 'sheet' ? 'w-full max-w-[430px] rounded-t-[26px] p-5 pb-9 border-t' : 'w-[calc(100%-32px)] max-w-[400px] rounded-[22px] p-6 mb-auto mt-auto border'
          )}
        >
          {variant === 'sheet' && <div className="w-9 h-0.5 bg-[rgba(80,70,160,0.18)] rounded-full mx-auto mb-5" />}
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
