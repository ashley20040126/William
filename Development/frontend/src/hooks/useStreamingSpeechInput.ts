import { useEffect, useRef, useState } from 'react';
import { type VoiceApiError, getVoiceApiErrorMessage, transcribeVoice, transcribeVoiceChunk } from '@/services/voiceApi';
import type { AppLanguage } from '@/services/store';
import { translateText } from '@/i18n/messages';
import { normalizeChineseScript } from '@/utils/chineseScript';

export type StreamingSpeechStatus = 'idle' | 'starting' | 'listening' | 'finalizing' | 'error';

type StopResult = {
  text: string;
  durationSeconds: number;
  usedPreviewFallback: boolean;
  finalTranscribeError: VoiceApiError | null;
};

type PreviewTask = {
  blob: Blob;
  token: number;
};

type AudioContextLike = typeof globalThis.AudioContext;

const PREVIEW_TIMESLICE_MS = 1800;
const PREVIEW_WINDOW_CHUNK_LIMIT = 3;
const DURATION_TICK_MS = 250;
const VOICE_ACTIVITY_POLL_MS = 120;
const VOICE_ACTIVITY_EVENT_THROTTLE_MS = 280;
const VOICE_ACTIVITY_RMS_THRESHOLD = 0.018;

export function useStreamingSpeechInput(language: AppLanguage = 'zh-CN') {
  const mountedRef = useRef(true);
  const runtimeStatusRef = useRef<StreamingSpeechStatus>('idle');

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mimeTypeRef = useRef('audio/webm');
  const captureChunksRef = useRef<BlobPart[]>([]);
  const previewWindowChunksRef = useRef<BlobPart[]>([]);
  const previewQueueRef = useRef<PreviewTask | null>(null);
  const previewInFlightRef = useRef(false);
  const previewTokenRef = useRef(0);
  const previewEnabledRef = useRef(false);
  const previewTranscriptRef = useRef('');
  const previewCommittedTranscriptRef = useRef('');
  const previewWindowTranscriptRef = useRef('');
  const pendingStopResolverRef = useRef<((audio: Blob | null) => void) | null>(null);

  const activityAudioContextRef = useRef<AudioContext | null>(null);
  const activitySourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const activityAnalyserRef = useRef<AnalyserNode | null>(null);
  const activityDataRef = useRef<Float32Array | null>(null);
  const activityTimerRef = useRef<number | null>(null);
  const lastActivityEventAtRef = useRef(0);

  const durationTimerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef(0);
  const lastActivityAtRef = useRef(0);

  const [status, setStatus] = useState<StreamingSpeechStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [error, setError] = useState('');
  const [lastActivityAt, setLastActivityAt] = useState(0);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      teardownSession({ dropChunks: true, resetPreviewTranscript: true, resetActivityTimestamp: false });
      clearDurationTimer();
    };
  }, []);

  async function start() {
    if (runtimeStatusRef.current === 'starting' || runtimeStatusRef.current === 'listening') {
      return true;
    }
    if (runtimeStatusRef.current === 'finalizing') {
      return false;
    }
    if (!checkSpeechInputSupport()) {
      setErrorSafe(translateText(language, '当前浏览器不支持语音输入。'));
      setStatusSafe('error');
      return false;
    }

    resetSessionState();
    setStatusSafe('starting');
    setErrorSafe('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (!mountedRef.current) {
        stopTracks(stream);
        return false;
      }

      const mimeType = pickSupportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const previewToken = previewTokenRef.current + 1;

      previewTokenRef.current = previewToken;
      previewEnabledRef.current = true;
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      mimeTypeRef.current = recorder.mimeType || mimeType || 'audio/webm';
      captureChunksRef.current = [];
      previewWindowChunksRef.current = [];
      previewQueueRef.current = null;
      pendingStopResolverRef.current = null;
      previewTranscriptRef.current = '';
      previewCommittedTranscriptRef.current = '';
      previewWindowTranscriptRef.current = '';

      recorder.ondataavailable = (event) => {
        if (event.data.size <= 0) return;
        captureChunksRef.current.push(event.data);
        previewWindowChunksRef.current.push(event.data);
        if (previewWindowChunksRef.current.length > PREVIEW_WINDOW_CHUNK_LIMIT) {
          previewWindowChunksRef.current.shift();
        }
        if (!previewEnabledRef.current) return;
        queuePreviewWindow(
          new Blob(previewWindowChunksRef.current, { type: mimeTypeRef.current }),
          previewToken
        );
      };
      recorder.onstop = () => {
        const audioBlob = buildAudioBlob();
        disposeRecorderAndStream();
        const resolver = pendingStopResolverRef.current;
        pendingStopResolverRef.current = null;
        if (resolver) {
          resolver(audioBlob);
        }
      };
      recorder.onerror = () => {
        previewEnabledRef.current = false;
        clearDurationTimer();
        stopActivityMonitor();
        disposeRecorderAndStream();
        setStatusSafe('error');
        setErrorSafe(translateText(language, '录音失败，请检查麦克风权限。'));
      };

      startDurationTimer();
      startActivityMonitor(stream);
      recorder.start(PREVIEW_TIMESLICE_MS);
      setStatusSafe('listening');
      return true;
    } catch (startError) {
      console.error('[StreamingSpeechInput] start failed:', startError);
      teardownSession({ dropChunks: true, resetPreviewTranscript: true, resetActivityTimestamp: true });
      setStatusSafe('error');
      setErrorSafe(translateText(language, '无法访问麦克风，请检查权限设置。'));
      return false;
    }
  }

  async function stop(): Promise<StopResult | null> {
    const frozenDurationSeconds = getCurrentDurationSeconds();
    if (runtimeStatusRef.current === 'finalizing') {
      return null;
    }

    previewEnabledRef.current = false;
    previewQueueRef.current = null;
    previewTokenRef.current += 1;

    if (!mediaRecorderRef.current) {
      clearDurationTimer();
      stopActivityMonitor();
      setStatusSafe('idle');
      return {
        text: transcript.trim(),
        durationSeconds: frozenDurationSeconds,
        usedPreviewFallback: false,
        finalTranscribeError: null,
      };
    }

    setStatusSafe('finalizing');
    stopActivityMonitor();

    const audio = await stopRecorderAndCollectAudio();
    if (!audio) {
      clearDurationTimer();
      setStatusSafe('idle');
      return {
        text: transcript.trim(),
        durationSeconds: frozenDurationSeconds,
        usedPreviewFallback: false,
        finalTranscribeError: null,
      };
    }

    const data = await transcribeVoice(audio);
    if (!data.ok) {
      console.warn('[StreamingSpeechInput] final transcribe failed:', data.error);
    }
    const fallbackText = transcript.trim();
    const usedPreviewFallback = !data.ok && Boolean(fallbackText);
    const finalText = normalizeTranscript(
      data.ok
        ? String(data.data.text || '').trim() || fallbackText
        : fallbackText
    );
    previewTranscriptRef.current = finalText;
    setTranscriptSafe(finalText);
    if (data.ok) {
      setErrorSafe('');
    } else if (usedPreviewFallback) {
      setErrorSafe('');
    } else {
      setErrorSafe(getVoiceApiErrorMessage(data.error, 'speech-input', language));
    }
    clearDurationTimer();
    setStatusSafe('idle');

    return {
      text: finalText,
      durationSeconds: frozenDurationSeconds,
      usedPreviewFallback,
      finalTranscribeError: data.ok ? null : data.error,
    };
  }

  function cancel() {
    previewTokenRef.current += 1;
    teardownSession({ dropChunks: true, resetPreviewTranscript: true, resetActivityTimestamp: true });
    clearDurationTimer();
    resetSessionState();
    setStatusSafe('idle');
    setErrorSafe('');
  }

  function resetSessionState() {
    previewTranscriptRef.current = '';
    previewCommittedTranscriptRef.current = '';
    previewWindowTranscriptRef.current = '';
    captureChunksRef.current = [];
    previewWindowChunksRef.current = [];
    previewQueueRef.current = null;
    pendingStopResolverRef.current = null;
    setTranscriptSafe('');
    setDurationSecondsSafe(0);
    setLastActivityAtSafe(0);
  }

  function queuePreviewWindow(blob: Blob, token: number) {
    previewQueueRef.current = { blob, token };
    if (previewInFlightRef.current) return;
    previewInFlightRef.current = true;
    void flushPreviewQueue();
  }

  async function flushPreviewQueue() {
    while (previewQueueRef.current) {
      const task = previewQueueRef.current;
      previewQueueRef.current = null;

      const data = await transcribeVoiceChunk(task.blob);
      if (task.token !== previewTokenRef.current) {
        continue;
      }

      if (!data.ok) {
        console.warn('[StreamingSpeechInput] preview transcribe failed:', data.error);
        continue;
      }

      const windowText = normalizeTranscript(String(data.data.text || '').trim());
      if (!windowText) {
        continue;
      }

      const stitched = stitchPreviewTranscript(
        previewCommittedTranscriptRef.current,
        previewWindowTranscriptRef.current,
        windowText
      );
      previewCommittedTranscriptRef.current = stitched.committed;
      previewWindowTranscriptRef.current = stitched.window;
      previewTranscriptRef.current = stitched.full;
      setTranscriptSafe(stitched.full);
    }

    previewInFlightRef.current = false;
    if (previewQueueRef.current) {
      previewInFlightRef.current = true;
      void flushPreviewQueue();
    }
  }

  function startActivityMonitor(stream: MediaStream) {
    stopActivityMonitor();
    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) return;

    try {
      const audioContext = new AudioContextCtor();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.1;
      source.connect(analyser);

      activityAudioContextRef.current = audioContext;
      activitySourceRef.current = source;
      activityAnalyserRef.current = analyser;
      activityDataRef.current = new Float32Array(
        new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT)
      );

      void audioContext.resume().catch(() => {});

      activityTimerRef.current = window.setInterval(() => {
        const activeAnalyser = activityAnalyserRef.current;
        const activeBuffer = activityDataRef.current;
        if (!activeAnalyser || !activeBuffer) return;
        activeAnalyser.getFloatTimeDomainData(activeBuffer as Float32Array<ArrayBuffer>);

        const rms = computeRms(activeBuffer);
        if (rms < VOICE_ACTIVITY_RMS_THRESHOLD) return;

        const now = Date.now();
        lastActivityAtRef.current = now;
        if (now - lastActivityEventAtRef.current < VOICE_ACTIVITY_EVENT_THROTTLE_MS) {
          return;
        }

        lastActivityEventAtRef.current = now;
        setLastActivityAtSafe(now);
      }, VOICE_ACTIVITY_POLL_MS);
    } catch (monitorError) {
      console.warn('[StreamingSpeechInput] activity monitor unavailable:', monitorError);
    }
  }

  function stopActivityMonitor() {
    if (activityTimerRef.current) {
      window.clearInterval(activityTimerRef.current);
      activityTimerRef.current = null;
    }
    activitySourceRef.current?.disconnect();
    activitySourceRef.current = null;
    activityAnalyserRef.current = null;
    activityDataRef.current = null;
    if (activityAudioContextRef.current) {
      void activityAudioContextRef.current.close().catch(() => {});
      activityAudioContextRef.current = null;
    }
    lastActivityEventAtRef.current = 0;
  }

  function startDurationTimer() {
    clearDurationTimer();
    recordingStartedAtRef.current = Date.now();
    setDurationSecondsSafe(0);
    durationTimerRef.current = window.setInterval(() => {
      setDurationSecondsSafe(getCurrentDurationSeconds());
    }, DURATION_TICK_MS);
  }

  function clearDurationTimer() {
    if (durationTimerRef.current) {
      window.clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }

  function getCurrentDurationSeconds() {
    if (!recordingStartedAtRef.current) return durationSeconds;
    return Math.max(0, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
  }

  async function stopRecorderAndCollectAudio() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      return buildAudioBlob();
    }
    if (recorder.state === 'inactive') {
      const audioBlob = buildAudioBlob();
      disposeRecorderAndStream();
      return audioBlob;
    }

    return new Promise<Blob | null>((resolve) => {
      pendingStopResolverRef.current = resolve;
      try {
        recorder.stop();
      } catch {
        pendingStopResolverRef.current = null;
        const audioBlob = buildAudioBlob();
        disposeRecorderAndStream();
        resolve(audioBlob);
      }
    });
  }

  function buildAudioBlob() {
    if (captureChunksRef.current.length === 0) {
      return null;
    }
    return new Blob(captureChunksRef.current, { type: mimeTypeRef.current });
  }

  function teardownSession(options: {
    dropChunks: boolean;
    resetPreviewTranscript: boolean;
    resetActivityTimestamp: boolean;
  }) {
    previewEnabledRef.current = false;
    previewQueueRef.current = null;
    pendingStopResolverRef.current = null;
    stopActivityMonitor();
    disposeRecorderAndStream();
    if (options.dropChunks) {
      captureChunksRef.current = [];
      previewWindowChunksRef.current = [];
    }
    if (options.resetPreviewTranscript) {
      previewTranscriptRef.current = '';
      previewCommittedTranscriptRef.current = '';
      previewWindowTranscriptRef.current = '';
    }
    if (options.resetActivityTimestamp) {
      lastActivityAtRef.current = 0;
    }
  }

  function disposeRecorderAndStream() {
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {}
      }
    }
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      stopTracks(streamRef.current);
      streamRef.current = null;
    }
  }

  function setStatusSafe(nextStatus: StreamingSpeechStatus) {
    runtimeStatusRef.current = nextStatus;
    if (mountedRef.current) {
      setStatus(nextStatus);
    }
  }

  function setTranscriptSafe(nextTranscript: string) {
    if (mountedRef.current) {
      setTranscript(nextTranscript);
    }
  }

  function setDurationSecondsSafe(nextDurationSeconds: number) {
    if (mountedRef.current) {
      setDurationSeconds(nextDurationSeconds);
    }
  }

  function setErrorSafe(nextError: string) {
    if (mountedRef.current) {
      setError(nextError);
    }
  }

  function setLastActivityAtSafe(nextLastActivityAt: number) {
    if (mountedRef.current) {
      setLastActivityAt(nextLastActivityAt);
    }
  }

  function normalizeTranscript(value: string) {
    return normalizeChineseScript(value, language).trim();
  }

  return {
    status,
    transcript,
    durationSeconds,
    error,
    lastActivityAt,
    isListening: status === 'starting' || status === 'listening',
    isFinalizing: status === 'finalizing',
    start,
    stop,
    cancel,
  };
}

function checkSpeechInputSupport() {
  return typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== 'undefined';
}

function pickSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const preferred = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ];
  return preferred.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
}

function getAudioContextCtor(): AudioContextLike | null {
  if (typeof window === 'undefined') return null;
  return globalThis.AudioContext
    || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    || null;
}

function stopTracks(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

function computeRms(buffer: ArrayLike<number>) {
  let total = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    total += buffer[index] * buffer[index];
  }
  return Math.sqrt(total / Math.max(buffer.length, 1));
}

function stitchPreviewTranscript(committedText: string, previousWindowText: string, nextWindowText: string) {
  const committed = String(committedText || '').trim();
  const previousWindow = String(previousWindowText || '').trim();
  const nextWindow = String(nextWindowText || '').trim();
  if (!previousWindow) {
    return {
      committed,
      window: nextWindow,
      full: joinTranscriptParts(committed, nextWindow),
    };
  }
  if (!nextWindow) {
    return {
      committed,
      window: previousWindow,
      full: joinTranscriptParts(committed, previousWindow),
    };
  }

  const unitMode = resolveTranscriptUnitMode(previousWindow, nextWindow);
  const previousUnits = splitTranscriptUnits(previousWindow, unitMode);
  const nextUnits = splitTranscriptUnits(nextWindow, unitMode);
  const previousComparable = previousUnits.map(toComparableUnit);
  const nextComparable = nextUnits.map(toComparableUnit);

  if (arraysEqual(previousComparable, nextComparable)) {
    return {
      committed,
      window: nextWindow,
      full: joinTranscriptParts(committed, nextWindow),
    };
  }

  const overlapLength = findUnitOverlap(previousComparable, nextComparable);
  if (overlapLength > 0) {
    const prefixToCommit = joinTranscriptUnits(
      previousUnits.slice(0, previousUnits.length - overlapLength),
      unitMode
    );
    const nextCommitted = joinTranscriptParts(committed, prefixToCommit);
    return {
      committed: nextCommitted,
      window: nextWindow,
      full: joinTranscriptParts(nextCommitted, nextWindow),
    };
  }

  const previousContainsNextAtTail = findContainedTailIndex(previousComparable, nextComparable);
  if (previousContainsNextAtTail >= 0) {
    const prefixToCommit = joinTranscriptUnits(
      previousUnits.slice(0, previousContainsNextAtTail),
      unitMode
    );
    const nextCommitted = joinTranscriptParts(committed, prefixToCommit);
    return {
      committed: nextCommitted,
      window: nextWindow,
      full: joinTranscriptParts(nextCommitted, nextWindow),
    };
  }

  const commonPrefixLength = findCommonPrefixLength(previousComparable, nextComparable);
  if (commonPrefixLength >= Math.max(2, Math.min(previousComparable.length, nextComparable.length) - 1)) {
    return {
      committed,
      window: nextWindow,
      full: joinTranscriptParts(committed, nextWindow),
    };
  }

  return {
    committed: joinTranscriptParts(committed, previousWindow),
    window: nextWindow,
    full: joinTranscriptParts(joinTranscriptParts(committed, previousWindow), nextWindow),
  };
}

function resolveTranscriptUnitMode(a: string, b: string) {
  return /\s/.test(a) || /\s/.test(b) ? 'token' : 'char';
}

function splitTranscriptUnits(text: string, mode: 'token' | 'char') {
  return mode === 'token'
    ? text.split(/\s+/).filter(Boolean)
    : Array.from(text);
}

function joinTranscriptUnits(units: string[], mode: 'token' | 'char') {
  if (units.length === 0) return '';
  return mode === 'token' ? units.join(' ') : units.join('');
}

function toComparableUnit(value: string) {
  return value.replace(/^[\s.,!?;:，。！？；："'`]+|[\s.,!?;:，。！？；："'`]+$/g, '').toLowerCase();
}

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function findUnitOverlap(currentUnits: string[], nextUnits: string[]) {
  const maxLength = Math.min(currentUnits.length, nextUnits.length);
  for (let size = maxLength; size >= 2; size -= 1) {
    if (arraysEqual(currentUnits.slice(-size), nextUnits.slice(0, size))) {
      return size;
    }
  }
  return 0;
}

function findContainedTailIndex(currentUnits: string[], nextUnits: string[]) {
  if (nextUnits.length === 0 || nextUnits.length > currentUnits.length) {
    return -1;
  }
  for (let start = 0; start <= currentUnits.length - nextUnits.length; start += 1) {
    if (start + nextUnits.length !== currentUnits.length) continue;
    if (arraysEqual(currentUnits.slice(start, start + nextUnits.length), nextUnits)) {
      return start;
    }
  }
  return -1;
}

function findCommonPrefixLength(a: string[], b: string[]) {
  const limit = Math.min(a.length, b.length);
  let matches = 0;
  for (let index = 0; index < limit; index += 1) {
    if (a[index] !== b[index]) {
      break;
    }
    matches += 1;
  }
  return matches;
}

function joinTranscriptParts(base: string, addition: string) {
  const normalizedBase = String(base || '').trim();
  const normalizedAddition = String(addition || '').trim();
  if (!normalizedBase) return normalizedAddition;
  if (!normalizedAddition) return normalizedBase;
  if (/[A-Za-z0-9]$/.test(normalizedBase) && /^[A-Za-z0-9]/.test(normalizedAddition)) {
    return `${normalizedBase} ${normalizedAddition}`.trim();
  }
  return `${normalizedBase}${normalizedAddition}`.trim();
}
