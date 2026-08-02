import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { useLocation } from 'react-router-dom';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useStore } from '@/services/store';
import { getVoiceApiErrorMessage, syncAmbientListeningAudio } from '@/services/voiceApi';
import { useI18n } from '@/i18n/useI18n';
import { translateText } from '@/i18n/messages';

const AMBIENT_TIMESLICE_MS = 5000;

export default function AmbientListeningController() {
  const language = useStore((s) => s.language);
  const enabled = useStore((s) => s.ambientListeningEnabled);
  const active = useStore((s) => s.ambientListeningActive);
  const error = useStore((s) => s.ambientListeningError);
  const lastAnalysis = useStore((s) => s.ambientListeningLastAnalysis);
  const ambientTranscript = useStore((s) => s.ambientListeningTranscript);
  const chatSessionId = useStore((s) => s.chatSessionId);
  const setAmbientListeningState = useStore((s) => s.setAmbientListeningState);
  const setAmbientListeningEnabled = useStore((s) => s.setAmbientListeningEnabled);
  const setAmbientListeningSyncResult = useStore((s) => s.setAmbientListeningSyncResult);
  const recorder = useAudioRecorder();
  const location = useLocation();
  const { tx } = useI18n();
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const {
    supported,
    isRecording,
    error: recorderError,
    start,
    cancel,
  } = recorder;

  useEffect(() => {
    setAmbientListeningState({
      ambientListeningSupported: supported,
      ambientListeningActive: enabled && isRecording,
      ambientListeningInterim: isRecording ? tx('正在采集音频片段…') : '',
      ambientListeningError: recorderError || '',
    });
  }, [enabled, isRecording, recorderError, setAmbientListeningState, supported]);

  useEffect(() => {
    let disposed = false;

    if (!enabled) {
      cancel();
      setAmbientListeningState({
        ambientListeningActive: false,
        ambientListeningInterim: '',
      });
      return;
    }

    if (!supported) {
      setAmbientListeningEnabled(false);
      setAmbientListeningState({
        ambientListeningActive: false,
        ambientListeningError: tx('当前浏览器不支持后台监听。'),
      });
      return;
    }

    if (isRecording) return;

    void start({
      timesliceMs: AMBIENT_TIMESLICE_MS,
      onChunk: (chunk) => {
        syncQueueRef.current = syncQueueRef.current.then(async () => {
          if (disposed) return;

          const result = await syncAmbientListeningAudio(chunk, {
            sourcePage: normalizePage(location.pathname),
            sourceSessionKey: chatSessionId || '',
          });

          if (disposed) return;

          if (!result.ok) {
            const nextError = getVoiceApiErrorMessage(result.error, 'ambient-listening', language || 'zh-CN');
            setAmbientListeningState({
              ambientListeningError: nextError,
            });
            return;
          }

          if (result.data.transcript) {
            const currentTranscript = useStore.getState().ambientListeningTranscript;
            setAmbientListeningState({
              ambientListeningTranscript: currentTranscript
                ? `${currentTranscript} ${result.data.transcript}`.trim()
                : result.data.transcript,
              ambientListeningError: '',
            });
          }

          if (result.data.analysis) {
            setAmbientListeningSyncResult({
              syncedAt: new Date().toISOString(),
              analysis: result.data.analysis,
            });
          }
        });
      },
    });

    return () => {
      disposed = true;
    };
  }, [
    cancel,
    chatSessionId,
    enabled,
    isRecording,
    location.pathname,
    setAmbientListeningEnabled,
    setAmbientListeningState,
    setAmbientListeningSyncResult,
    start,
    supported,
  ]);

  useEffect(() => () => {
    cancel();
  }, [cancel]);

  if (!enabled && !active && !error) return null;

  const summary = error
    ? error
    : active
      ? buildSummary(ambientTranscript, lastAnalysis)
      : tx('正在恢复监听…');

  return (
    <div className="pointer-events-none absolute top-4 right-4 left-4 z-30 flex justify-center">
      <div
        className={clsx(
          'max-w-[300px] rounded-full border px-3 py-2 backdrop-blur-md shadow-[0_8px_24px_rgba(23,18,46,0.14)]',
          error
            ? 'bg-[rgba(244,225,234,0.94)] border-[rgba(196,82,122,0.18)]'
            : 'bg-[rgba(255,255,255,0.92)] border-[rgba(80,70,160,0.12)]'
        )}
      >
        <div className="flex items-center gap-2">
          <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', active ? 'bg-teal animate-pulse' : error ? 'bg-rose' : 'bg-gold')} />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-3 flex-shrink-0">
            {error ? tx('Listening Error') : active ? tx('Listening On') : tx('Reconnecting')}
          </span>
          <span className="text-[11px] text-ink-4 truncate">{summary}</span>
        </div>
      </div>
    </div>
  );
}

function buildSummary(
  transcript: string,
  analysis: {
    emotion: string;
    stress: number;
    patterns: string[];
    topics: string[];
    tokenCount: number;
  } | null
) {
  const language = useStore.getState().language || 'zh-CN';
  if (analysis?.stress) {
    return translateText(language, 'stress {stress}/10 · {emotion}', {
      stress: analysis.stress,
      emotion: translateText(language, analysis.emotion || 'neutral'),
    });
  }
  if (transcript) {
    return transcript;
  }
  return translateText(language, '正在后台监听');
}

function normalizePage(pathname: string) {
  if (pathname === '/') return 'today';
  if (pathname.startsWith('/chat')) return 'chat';
  if (pathname.startsWith('/journey')) return 'journey';
  if (pathname.startsWith('/you')) return 'you';
  return 'app';
}
