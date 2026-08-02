import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/services/store';
import { translateText } from '@/i18n/messages';

function pickSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const preferred = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ];
  return preferred.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export function useAudioRecorder() {
  const language = useStore((s) => s.language || 'zh-CN');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const onChunkRef = useRef<((chunk: Blob) => void | Promise<void>) | null>(null);
  const intervalRef = useRef<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [error, setError] = useState('');

  const supported = typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined';

  const mimeType = useMemo(() => pickSupportedMimeType(), []);

  useEffect(() => () => {
    cleanup();
  }, []);

  const start = useCallback(async (options?: {
    onChunk?: (chunk: Blob) => void | Promise<void>;
    timesliceMs?: number;
  }) => {
    if (!supported) {
      setError(translateText(language, '当前浏览器不支持录音。'));
      return false;
    }

    try {
      setError('');
      chunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      onChunkRef.current = options?.onChunk || null;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          onChunkRef.current?.(event.data);
        }
      };
      recorder.start(options?.timesliceMs && options.timesliceMs > 0 ? options.timesliceMs : undefined);
      setDurationSeconds(0);
      setIsRecording(true);
      intervalRef.current = window.setInterval(() => {
        setDurationSeconds((value) => value + 1);
      }, 1000);
      return true;
    } catch (err) {
      console.error('[AudioRecorder] start failed:', err);
      setError(translateText(language, '无法访问麦克风，请检查权限设置。'));
      cleanup();
      return false;
    }
  }, [language, mimeType, supported]);

  const stop = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      cleanup();
      return null;
    }

    return new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const blob = chunksRef.current.length > 0
          ? new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
          : null;
        cleanup();
        resolve(blob);
      };
      setIsRecording(false);
      recorder.stop();
    });
  }, [mimeType]);

  const cancel = useCallback(() => {
    cleanup(true);
  }, []);

  function cleanup(dropChunks = false) {
    if (dropChunks) {
      chunksRef.current = [];
    }
    onChunkRef.current = null;
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    streamRef.current?.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    streamRef.current = null;
    setIsRecording(false);
    setDurationSeconds(0);
  }

  return {
    supported,
    mimeType: mimeType || 'audio/webm',
    isRecording,
    durationSeconds,
    error,
    start,
    stop,
    cancel,
  };
}
