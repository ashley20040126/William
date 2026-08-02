import type { DayProfile } from '@/services/store';

export function toNumber(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getDisplayStress(profile?: Partial<DayProfile> | null, fallback = 0) {
  if (!profile) return fallback;
  const composite = profile.composite_stress == null ? null : toNumber(profile.composite_stress, fallback);
  const average = profile.stress_avg == null ? null : toNumber(profile.stress_avg, fallback);
  const ambient = profile.ambient_stress_avg == null ? null : toNumber(profile.ambient_stress_avg, fallback);

  if (composite != null && ambient != null) {
    return roundStress(composite * 0.65 + ambient * 0.35);
  }
  if (composite != null) return roundStress(composite);
  if (ambient != null) return roundStress(ambient);
  if (average != null) return roundStress(average);
  return fallback;
}

export function getStressSource(profile?: Partial<DayProfile> | null) {
  if (!profile) return 'fallback';
  const hasComposite = profile.composite_stress != null;
  const hasAverage = profile.stress_avg != null;
  const hasAmbient = profile.ambient_stress_avg != null;
  if (hasComposite && hasAmbient) return 'chat + journal + voice';
  if (hasComposite) return 'chat + journal';
  if (hasAmbient) return 'voice';
  if (hasAverage) return 'check-in';
  return 'fallback';
}

export function hasAmbientSignal(profile?: Partial<DayProfile> | null) {
  return Boolean(
    profile &&
    ((profile.ambient_stress_avg != null) ||
      (typeof profile.ambient_listening_count === 'number' && profile.ambient_listening_count > 0))
  );
}

function roundStress(value: number) {
  return Math.round(value * 10) / 10;
}
