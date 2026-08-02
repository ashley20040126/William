// ── Voices ──
export interface VoiceAvatarDef {
  glyph: string;
  badge: string;
  gradient: string;
  shadow: string;
}

export interface VoiceDef {
  id: string;
  sym: string;
  color: string;
  bg: string;
  name: string;
  tag: string;
  avatar: VoiceAvatarDef;
}

export const VOICES: readonly VoiceDef[] = [
  {
    id: 'classic',
    sym: '◆',
    color: '#8B7FCC',
    bg: '#EAE4F8',
    name: 'William Classic',
    tag: 'Warm & Steady',
    avatar: {
      glyph: '◆',
      badge: '+',
      gradient: 'linear-gradient(135deg, #7A67C7 0%, #A76FBB 52%, #D1638B 100%)',
      shadow: '0 8px 18px rgba(139, 127, 204, 0.34)',
    },
  },
  {
    id: 'direct',
    sym: '▲',
    color: '#3A8880',
    bg: '#DCF2F0',
    name: 'Digital Expert',
    tag: 'RAG Powered · Expert Brain',
    avatar: {
      glyph: '▲',
      badge: '=',
      gradient: 'linear-gradient(135deg, #0F7A6D 0%, #2A9693 54%, #5FB4CB 100%)',
      shadow: '0 8px 18px rgba(58, 136, 128, 0.32)',
    },
  },
  {
    id: 'gentle',
    sym: '●',
    color: '#C4527A',
    bg: '#F5E8EF',
    name: 'The Gentle Guide',
    tag: 'Soft · Nurturing',
    avatar: {
      glyph: '●',
      badge: '~',
      gradient: 'linear-gradient(135deg, #B84D74 0%, #D86E95 58%, #F3A0BA 100%)',
      shadow: '0 8px 18px rgba(196, 82, 122, 0.3)',
    },
  },
  {
    id: 'coach',
    sym: '◉',
    color: '#B89020',
    bg: '#F8F0D8',
    name: 'The Coach',
    tag: 'Action-oriented',
    avatar: {
      glyph: '◉',
      badge: '!',
      gradient: 'linear-gradient(135deg, #9A7310 0%, #C7962A 50%, #E0B85A 100%)',
      shadow: '0 8px 18px rgba(184, 144, 32, 0.3)',
    },
  },
  {
    id: 'night',
    sym: '☽',
    color: '#6058A0',
    bg: '#E8E4F8',
    name: 'Night Owl',
    tag: 'Calm · Introspective',
    avatar: {
      glyph: '☽',
      badge: '*',
      gradient: 'linear-gradient(135deg, #35305F 0%, #5C56A7 58%, #857FE0 100%)',
      shadow: '0 8px 18px rgba(96, 88, 160, 0.32)',
    },
  },
];

// ── Challenges ──
export const CHALLENGES = [
  { icon: '😰', label: 'Anxiety' }, { icon: '😔', label: 'Low mood' },
  { icon: '💤', label: 'Sleep' }, { icon: '😤', label: 'Anger' },
  { icon: '🔥', label: 'Burnout' }, { icon: '💔', label: 'Heartbreak' },
  { icon: '😶', label: 'Numbness' }, { icon: '🤝', label: 'Relationships' },
  { icon: '🎯', label: 'Focus' }, { icon: '💰', label: 'Finances' },
] as const;

// ── Moods ──
export const MOOD_EMOJI = ['😊', '🙂', '😐', '😔', '😰'] as const;
export const MOOD_LABEL = ['Great', 'Good', 'Okay', 'Low', 'Anxious'] as const;

// ── Levels ──
export const LEVEL_TITLE = ['Explorer', 'Seeker', 'Journeyer', 'Voyager', 'Sage', 'Luminary'];
export const LEVEL_XP = [0, 200, 500, 1000, 1800, 3000];

export function calcLevel(xp: number) {
  let lv = 1;
  for (let i = 1; i < LEVEL_XP.length; i++) { if (xp >= LEVEL_XP[i]) lv = i + 1; else break; }
  lv = Math.min(lv, LEVEL_TITLE.length);
  const next = LEVEL_XP[Math.min(lv, LEVEL_TITLE.length - 1)];
  const curr = LEVEL_XP[lv - 1];
  const pct = lv < LEVEL_TITLE.length ? Math.round(((xp - curr) / (next - curr)) * 100) : 100;
  return { level: lv, title: LEVEL_TITLE[lv - 1], next, pct };
}
