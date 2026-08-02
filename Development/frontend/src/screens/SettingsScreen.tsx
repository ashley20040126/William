import { useNavigate } from 'react-router-dom';
import { useStore } from '@/services/store';
import * as api from '@/services/api';
import { setToken } from '@/services/api';
import { SectionLabel } from '@/components/ui';
import { useEffect, useState } from 'react';
import type { AppLanguage } from '@/services/store';
import { useI18n } from '@/i18n/useI18n';
import type { UserActiveLoop, UserInterventionPreference, UserMemory } from '@/services/userApi';

const PERM_LABELS: Record<string, { ico: string; label: string }> = {
  mic: { ico: '🎙️', label: 'Microphone' },
  notifs: { ico: '🔔', label: 'Notifications' },
  health: { ico: '❤️', label: 'Health & Activity' },
  calendar: { ico: '📅', label: 'Calendar' },
  location: { ico: '📍', label: 'Location' },
};

const LANGUAGE_OPTIONS: Array<{ value: AppLanguage; label: string; detail: string }> = [
  { value: 'zh-CN', label: '中文', detail: 'STT 和 TTS 默认使用中文。' },
  { value: 'en-US', label: 'English', detail: 'STT and TTS default to English.' },
];

export default function SettingsScreen() {
  const nav = useNavigate();
  const s = useStore();
  const { tx } = useI18n();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [activeLoops, setActiveLoops] = useState<UserActiveLoop[]>([]);
  const [helpfulInterventions, setHelpfulInterventions] = useState<UserInterventionPreference[]>([]);
  const [avoidInterventions, setAvoidInterventions] = useState<UserInterventionPreference[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [memoryActionId, setMemoryActionId] = useState<number | null>(null);
  const [activeLoopActionId, setActiveLoopActionId] = useState<number | null>(null);
  const [storyOpenAIKeyInput, setStoryOpenAIKeyInput] = useState('');
  const [storyOpenAIKeyConfigured, setStoryOpenAIKeyConfigured] = useState(false);
  const [storyOpenAIKeyMasked, setStoryOpenAIKeyMasked] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMemoryCenter() {
      setMemoriesLoading(true);
      setError('');
      try {
        const [profile, memoryOverview] = await Promise.all([
          api.getProfile(),
          api.getMemories(24),
        ]);

        if (cancelled) return;

        if (profile && profile.memory_enabled != null) {
          s.set({ memoryEnabled: Boolean(Number(profile.memory_enabled)) });
        }
        if (profile && profile.ambient_asr_enabled != null) {
          s.set({ ambientASREnabled: Boolean(Number(profile.ambient_asr_enabled)) });
        }
        setStoryOpenAIKeyConfigured(Boolean(profile?.story_openai_api_key_configured));
        setStoryOpenAIKeyMasked(typeof profile?.story_openai_api_key_masked === 'string'
          ? profile.story_openai_api_key_masked
          : null);
        if (memoryOverview?.memories) {
          setMemories(memoryOverview.memories);
        }
        if (memoryOverview?.activeLoops) {
          setActiveLoops(memoryOverview.activeLoops);
        }
        if (memoryOverview?.interventionOverview) {
          setHelpfulInterventions(memoryOverview.interventionOverview.topHelpful || []);
          setAvoidInterventions(memoryOverview.interventionOverview.avoid || []);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : tx('Failed to load data'));
      } finally {
        if (!cancelled) {
          setMemoriesLoading(false);
        }
      }
    }

    void loadMemoryCenter();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    setError('');
    try {
      await api.logoutOrThrow();
    } catch {
      // 服务端退出失败时，本地仍然应该清掉会话，避免用户卡死在脏状态
    } finally {
      setToken(null);
      s.reset();
    }
  };

  const handleTogglePerm = async (key: string) => {
    if (savingKey) return;
    const nextPerms = { ...s.perms, [key]: !s.perms[key] };
    setSavingKey(key);
    setError('');

    try {
      await api.saveProfileOrThrow({ perms: nextPerms });
      s.set({ perms: nextPerms });
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('Failed to update settings'));
    } finally {
      setSavingKey(null);
    }
  };

  const handleLanguageChange = async (nextLanguage: AppLanguage) => {
    if (savingKey || s.language === nextLanguage) return;
    const previousLanguage = s.language;
    setSavingKey('language');
    setError('');
    s.set({ language: nextLanguage });

    try {
      await api.saveProfileOrThrow({ language: nextLanguage });
    } catch (err) {
      s.set({ language: previousLanguage });
      setError(err instanceof Error ? err.message : tx('Failed to update settings'));
    } finally {
      setSavingKey(null);
    }
  };

  const handleMemoryEnabledChange = async (nextEnabled: boolean) => {
    if (savingKey === 'memory') return;
    const previous = s.memoryEnabled;
    setSavingKey('memory');
    setError('');
    s.set({ memoryEnabled: nextEnabled });

    try {
      await api.saveProfileOrThrow({ memory_enabled: nextEnabled ? 1 : 0 });
    } catch (err) {
      s.set({ memoryEnabled: previous });
      setError(err instanceof Error ? err.message : tx('Failed to update settings'));
    } finally {
      setSavingKey(null);
    }
  };

  const handleAmbientASREnabledChange = async (nextEnabled: boolean) => {
    if (savingKey === 'ambient-asr') return;
    const previous = s.ambientASREnabled;
    setSavingKey('ambient-asr');
    setError('');
    s.set({ ambientASREnabled: nextEnabled });

    try {
      await api.saveProfileOrThrow({ ambient_asr_enabled: nextEnabled ? 1 : 0 });
    } catch (err) {
      s.set({ ambientASREnabled: previous });
      setError(err instanceof Error ? err.message : tx('Failed to update settings'));
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveStoryOpenAIKey = async () => {
    const nextKey = storyOpenAIKeyInput.trim();
    if (!nextKey || savingKey === 'story-openai-key') return;
    setSavingKey('story-openai-key');
    setError('');

    try {
      await api.saveProfileOrThrow({ story_openai_api_key: nextKey });
      setStoryOpenAIKeyConfigured(true);
      setStoryOpenAIKeyMasked(maskApiKey(nextKey));
      setStoryOpenAIKeyInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('Failed to update settings'));
    } finally {
      setSavingKey(null);
    }
  };

  const handleClearStoryOpenAIKey = async () => {
    if (savingKey === 'story-openai-key') return;
    setSavingKey('story-openai-key');
    setError('');

    try {
      await api.saveProfileOrThrow({ story_openai_api_key: '' });
      setStoryOpenAIKeyConfigured(false);
      setStoryOpenAIKeyMasked(null);
      setStoryOpenAIKeyInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('Failed to update settings'));
    } finally {
      setSavingKey(null);
    }
  };

  const handleDeleteMemory = async (memoryId: number) => {
    if (memoryActionId) return;
    setMemoryActionId(memoryId);
    setError('');

    try {
      await api.updateMemoryStatus(memoryId, 'deleted');
      setMemories((prev) => prev.filter((item) => item.id !== memoryId));
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('Failed to update settings'));
    } finally {
      setMemoryActionId(null);
    }
  };

  const handleResolveActiveLoop = async (loopId: number) => {
    if (activeLoopActionId) return;
    setActiveLoopActionId(loopId);
    setError('');

    try {
      await api.updateActiveLoopStatus(loopId, 'resolved');
      setActiveLoops((prev) => prev.filter((item) => item.id !== loopId));
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('Failed to update settings'));
    } finally {
      setActiveLoopActionId(null);
    }
  };

  return (
    <div className="h-full max-w-[430px] mx-auto bg-bg overflow-y-auto scroll-area">
      <div className="p-6" style={{ paddingTop: 'max(env(safe-area-inset-top, 20px), 20px)' }}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[11px] font-bold text-ink-4 uppercase tracking-wider mb-1">{tx('You')}</p>
            <h1 className="text-heading text-[26px] text-ink">{tx('Settings')}</h1>
          </div>
          <button onClick={() => nav(-1)} className="text-2xl text-ink-3 bg-transparent border-none cursor-pointer">✕</button>
        </div>

        <div className="mb-4">
          <SectionLabel className="block mb-2.5">{tx('Language')}</SectionLabel>
          <div className="bg-white rounded-2xl border border-[rgba(80,70,160,0.1)] overflow-hidden">
            {LANGUAGE_OPTIONS.map((option, index) => {
              const active = s.language === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => handleLanguageChange(option.value)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer bg-transparent border-none ${
                    index < LANGUAGE_OPTIONS.length - 1 ? 'border-b border-[rgba(80,70,160,0.07)]' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-ink">{option.label}</div>
                    <div className="text-[12px] text-ink-4 mt-0.5">{tx(option.detail)}</div>
                  </div>
                  {savingKey === 'language' ? (
                    <span className="text-[11px] font-semibold text-ink-4">{tx('Saving…')}</span>
                  ) : null}
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                    active
                      ? 'border-teal bg-teal/10'
                      : 'border-[rgba(80,70,160,0.18)] bg-transparent'
                  }`}
                  >
                    <div className={`w-2.5 h-2.5 rounded-full ${active ? 'bg-teal' : 'bg-transparent'}`} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-4">
          <SectionLabel className="block mb-2.5">{tx('Privacy & Data')}</SectionLabel>
          <div className="bg-white rounded-2xl border border-[rgba(80,70,160,0.1)] overflow-hidden">
            {Object.entries(PERM_LABELS).map(([key, { ico, label }], index, arr) => (
              <button
                key={key}
                onClick={() => handleTogglePerm(key)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer bg-transparent border-none ${
                  index < arr.length - 1 ? 'border-b border-[rgba(80,70,160,0.07)]' : ''
                }`}
              >
                <span className="text-lg">{ico}</span>
                <span className="flex-1 text-[14px] font-semibold text-ink">{tx(label)}</span>
                {savingKey === key ? (
                  <span className="text-[11px] font-semibold text-ink-4">{tx('Saving…')}</span>
                ) : null}
                <div className={`w-9 h-5 rounded-full relative transition-colors ${s.perms[key] ? 'bg-teal' : 'bg-[rgba(80,70,160,0.15)]'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${s.perms[key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-ink-4 text-center mt-2 leading-relaxed">{tx('All signals processed with user consent. Delete data anytime.')}</p>
          {error ? (
            <p className="mt-3 text-[12px] text-rose text-center">{error}</p>
          ) : null}
        </div>

        <div className="mb-4">
          <SectionLabel className="block mb-2.5">{tx('AI Comics')}</SectionLabel>
          <div className="bg-white rounded-2xl border border-[rgba(80,70,160,0.1)] overflow-hidden px-4 py-4">
            <div className="flex items-start gap-3">
              <span className="text-lg">🖼️</span>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-ink">{tx('OpenAI API key for comic images')}</p>
                <p className="text-[12px] text-ink-4 mt-1 leading-relaxed">
                  {tx('AI comic images only run with your own OpenAI API key. If you leave this empty, the comic area will show the default fallback artwork.')}
                </p>
                {storyOpenAIKeyConfigured && storyOpenAIKeyMasked ? (
                  <p className="text-[11px] text-teal mt-2">
                    {tx('Connected key: {masked}', { masked: storyOpenAIKeyMasked })}
                  </p>
                ) : (
                  <p className="text-[11px] text-ink-4 mt-2">{tx('No API key connected yet.')}</p>
                )}
              </div>
            </div>
            <input
              type="password"
              value={storyOpenAIKeyInput}
              onChange={(event) => setStoryOpenAIKeyInput(event.target.value)}
              placeholder={tx('Paste your OpenAI API key')}
              className="w-full mt-4 rounded-2xl border border-[rgba(80,70,160,0.12)] bg-bg px-4 py-3 text-[13px] text-ink outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={handleSaveStoryOpenAIKey}
                disabled={savingKey === 'story-openai-key' || !storyOpenAIKeyInput.trim()}
                className="flex-1 py-3 rounded-2xl text-[13px] font-semibold text-white bg-ink border-none cursor-pointer disabled:opacity-50"
              >
                {savingKey === 'story-openai-key' ? tx('Saving…') : tx('Save API key')}
              </button>
              {storyOpenAIKeyConfigured && (
                <button
                  type="button"
                  onClick={handleClearStoryOpenAIKey}
                  disabled={savingKey === 'story-openai-key'}
                  className="px-4 py-3 rounded-2xl text-[13px] font-semibold text-rose bg-transparent border border-rose/20 cursor-pointer disabled:opacity-50"
                >
                  {tx('Remove key')}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mb-4">
          <SectionLabel className="block mb-2.5">{tx('Memory')}</SectionLabel>
          <div className="bg-white rounded-2xl border border-[rgba(80,70,160,0.1)] overflow-hidden">
            <button
              onClick={() => handleMemoryEnabledChange(!s.memoryEnabled)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer bg-transparent border-none border-b border-[rgba(80,70,160,0.07)]"
            >
              <span className="text-lg">🧠</span>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-ink">{tx(s.memoryEnabled ? 'Memory is on' : 'Memory is off')}</div>
                <div className="text-[12px] text-ink-4 mt-0.5">
                  {s.memoryEnabled
                    ? tx('William can use saved memories in future chats.')
                    : tx('William will stop using and updating saved memories.')}
                </div>
              </div>
              {savingKey === 'memory' ? (
                <span className="text-[11px] font-semibold text-ink-4">{tx('Saving…')}</span>
              ) : null}
              <div className={`w-9 h-5 rounded-full relative transition-colors ${s.memoryEnabled ? 'bg-teal' : 'bg-[rgba(80,70,160,0.15)]'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${s.memoryEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </button>
            <div className="px-4 py-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[13px] font-semibold text-ink">{tx('What helps more')}</p>
                {memoriesLoading ? <span className="text-[11px] text-ink-4">{tx('Loading…')}</span> : null}
              </div>
              <div className="space-y-2 mb-4">
                {!memoriesLoading && helpfulInterventions.length === 0 ? (
                  <p className="text-[12px] text-ink-4">{tx('Still learning what helps most.')}</p>
                ) : (
                  helpfulInterventions.map((item) => (
                    <div key={`helpful-${item.interventionType}`} className="rounded-xl border border-[rgba(25,150,120,0.12)] bg-[rgba(25,150,120,0.06)] px-3 py-2.5">
                      <p className="text-[12px] font-semibold text-ink leading-relaxed">{item.summary}</p>
                      <p className="text-[10px] text-ink-4 mt-1">
                        {tx('Evidence {count} · score {score}', {
                          count: item.evidenceCount,
                          score: item.avgOutcomeScore.toFixed(2),
                        })}
                      </p>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[13px] font-semibold text-ink">{tx('What helps less')}</p>
              </div>
              <div className="space-y-2 mb-4">
                {!memoriesLoading && avoidInterventions.length === 0 ? (
                  <p className="text-[12px] text-ink-4">{tx('No weak patterns yet.')}</p>
                ) : (
                  avoidInterventions.map((item) => (
                    <div key={`avoid-${item.interventionType}`} className="rounded-xl border border-[rgba(196,82,122,0.12)] bg-[rgba(196,82,122,0.06)] px-3 py-2.5">
                      <p className="text-[12px] font-semibold text-ink leading-relaxed">{item.summary}</p>
                      <p className="text-[10px] text-ink-4 mt-1">
                        {tx('Evidence {count} · score {score}', {
                          count: item.evidenceCount,
                          score: item.avgOutcomeScore.toFixed(2),
                        })}
                      </p>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[13px] font-semibold text-ink">{tx('Active loops')}</p>
                {memoriesLoading ? <span className="text-[11px] text-ink-4">{tx('Loading…')}</span> : null}
              </div>
              <p className="text-[11px] text-ink-4 leading-relaxed mb-3">
                {tx('Temporary chat is controlled from the chat screen and will not create or use saved memories.')}
              </p>
              <div className="space-y-2">
                {!memoriesLoading && activeLoops.length === 0 ? (
                  <p className="text-[12px] text-ink-4">{tx('No active loops right now.')}</p>
                ) : (
                  activeLoops.map((loop) => (
                    <div key={loop.id} className="rounded-xl border border-[rgba(80,70,160,0.08)] bg-[rgba(255,255,255,0.82)] px-3 py-2.5">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold text-ink leading-relaxed">{loop.title}</p>
                          <p className="text-[11px] text-ink-4 mt-1 leading-relaxed">{loop.summary}</p>
                          <p className="text-[10px] text-ink-4 mt-1">
                            {tx('Seen {count} times · confidence {confidence}', {
                              count: loop.timesSeen,
                              confidence: `${Math.round((loop.confidence || 0) * 100)}%`,
                            })}
                            {loop.dueHint ? ` · ${tx('Due hint')}: ${loop.dueHint}` : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => handleResolveActiveLoop(loop.id)}
                          disabled={activeLoopActionId === loop.id}
                          className="text-[11px] font-bold text-teal border-none bg-transparent cursor-pointer disabled:opacity-50"
                        >
                          {activeLoopActionId === loop.id ? tx('Saving…') : tx('Mark resolved')}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="px-4 py-3 border-t border-[rgba(80,70,160,0.07)]">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[13px] font-semibold text-ink">{tx('Saved memories')}</p>
                {memoriesLoading ? <span className="text-[11px] text-ink-4">{tx('Loading…')}</span> : null}
              </div>
              <div className="space-y-2">
                {!memoriesLoading && memories.length === 0 ? (
                  <p className="text-[12px] text-ink-4">{tx('No saved memories yet.')}</p>
                ) : (
                  memories.map((memory) => (
                    <div key={memory.id} className="rounded-xl border border-[rgba(80,70,160,0.08)] bg-bg-2 px-3 py-2.5">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold text-ink leading-relaxed">{memory.content}</p>
                          <p className="text-[10px] text-ink-4 mt-1">
                            {tx('Seen {count} times · confidence {confidence}', {
                              count: memory.timesSeen,
                              confidence: `${Math.round((memory.confidence || 0) * 100)}%`,
                            })}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeleteMemory(memory.id)}
                          disabled={memoryActionId === memory.id}
                          className="text-[11px] font-bold text-rose border-none bg-transparent cursor-pointer disabled:opacity-50"
                        >
                          {memoryActionId === memory.id ? tx('Deleting…') : tx('Delete')}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <SectionLabel className="block mb-2.5">{tx('Ambient Listening')}</SectionLabel>
          <div className="bg-white rounded-2xl border border-[rgba(80,70,160,0.1)] overflow-hidden">
            <button
              onClick={() => handleAmbientASREnabledChange(!s.ambientASREnabled)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer bg-transparent border-none"
            >
              <span className="text-lg">🎧</span>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-ink">
                  {tx(s.ambientASREnabled ? 'Allow ASR for ambient listening' : 'Ambient listening text capture is off')}
                </div>
                <div className="text-[12px] text-ink-4 mt-0.5">
                  {s.ambientASREnabled
                    ? tx('Ambient listening can analyze voice signals and transcribe short listening clips.')
                    : tx('Ambient listening will only analyze stress, emotion, pace, and vitality without saving spoken text.')}
                </div>
              </div>
              {savingKey === 'ambient-asr' ? (
                <span className="text-[11px] font-semibold text-ink-4">{tx('Saving…')}</span>
              ) : null}
              <div className={`w-9 h-5 rounded-full relative transition-colors ${s.ambientASREnabled ? 'bg-teal' : 'bg-[rgba(80,70,160,0.15)]'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${s.ambientASREnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </button>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full py-3.5 rounded-2xl text-[14px] font-semibold text-rose border-[1.5px] border-rose/30 bg-transparent cursor-pointer"
        >
          {tx('Sign out')}
        </button>
      </div>
    </div>
  );
}

function maskApiKey(value: string) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized.length <= 8) return '••••••••';
  return `${normalized.slice(0, 6)}••••${normalized.slice(-4)}`;
}
