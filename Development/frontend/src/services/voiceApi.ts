import { ApiError, getApiBase, getToken, postForm, postJsonOrThrow } from '@/services/http';
import { useStore, type AppLanguage } from '@/services/store';
import { translateText } from '@/i18n/messages';
import { normalizeChineseScript } from '@/utils/chineseScript';

export type VoiceApiErrorCode =
  | 'validation'
  | 'unauthorized'
  | 'payload_too_large'
  | 'no_speech'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'server'
  | 'unknown';

export type VoiceApiError = {
  code: VoiceApiErrorCode;
  message: string;
};

export type VoiceApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: VoiceApiError };

type VoiceTranscriptPayload = {
  text: string;
  duration_ms?: number;
  language?: string | null;
  ignored?: boolean;
};

type VoiceTurnPayload = {
  transcript: string;
  reply: string;
  sessionId: string;
  analysis: { emotion: string; stress: number; patterns: string[] };
  voice?: { durationMs?: number | null; language?: string | null };
};

type VoiceTtsPayload = {
  audioBlob: Blob;
  contentType: string;
  language: string | null;
  voiceName: string | null;
};

type AmbientListeningPayload = {
  ok: boolean;
  deduped: boolean;
  asrEnabled?: boolean;
  analysis: {
    emotion: string;
    stress: number;
    patterns: string[];
    topics: string[];
    tokenCount: number;
    speechPace?: number;
    stability?: number;
    vocalVitality?: number;
    flags?: string[];
    durationMs?: number;
  };
  transcript?: string;
  voice?: {
    durationMs?: number | null;
    speechPace?: number | null;
    stability?: number | null;
    vocalVitality?: number | null;
    dominantEmotion?: string | null;
    flags?: string[];
  };
};

type AmbientListeningFinalizePayload = {
  ok: boolean;
  created: boolean;
  reason?: string;
  assistantMessage: {
    id?: number;
    role: 'assistant';
    content: string;
    ts: string;
    voiceId?: string;
  } | null;
  voiceInsight?: {
    date: string;
    severity: 'warning' | 'positive' | 'neutral';
    sampleCount: number;
    transcriptTokens: number;
    averageStress: number | null;
    highStressWindowCount: number;
    highStressWindows: string[];
    stabilityAverage: number | null;
    yesterdayStabilityAverage: number | null;
    stabilityDelta: number | null;
    stabilityDirection: 'lower' | 'higher' | 'similar' | 'unknown';
    speakingStyle: 'quiet' | 'balanced' | 'talkative';
    dominantEmotion: string;
  };
  practiceSuggestion?: {
    id: number;
    title: string;
    description: string;
  } | null;
  scheduleCandidates?: Array<{
    id: number;
    title: string;
    dateText: string;
    location: string;
    status: 'candidate' | 'confirmed' | 'dismissed' | 'edited';
  }>;
};

export async function transcribeVoice(audio: Blob): Promise<VoiceApiResult<VoiceTranscriptPayload>> {
  const formData = new FormData();
  formData.append('audio', audio, 'speech.webm');
  return withVoiceForm('/api/voice/transcribe', formData, normalizeTranscriptPayload);
}

export async function transcribeVoiceChunk(audio: Blob): Promise<VoiceApiResult<VoiceTranscriptPayload>> {
  const formData = new FormData();
  formData.append('audio', audio, 'speech-chunk.webm');
  return withVoiceForm('/api/voice/transcribe-chunk', formData, normalizeTranscriptPayload);
}

export async function sendVoiceTurnText(
  transcript: string,
  sessionId: string,
  temporaryChat = false
): Promise<VoiceApiResult<VoiceTurnPayload>> {
  return withVoiceJson('/api/voice/call-turn-text', { transcript, sessionId, temporaryChat }, normalizeVoiceTurnPayload);
}

export async function synthesizeVoice(text: string, language?: string): Promise<VoiceApiResult<VoiceTtsPayload>> {
  const authToken = getToken();
  if (!authToken) {
    return {
      ok: false,
      error: {
        code: 'unauthorized',
        message: 'Missing auth token',
      },
    };
  }

  try {
    const response = await fetch(`${getApiBase()}/api/voice/tts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, language }),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: {
          ...normalizeVoiceApiError(
            new ApiError(await readVoiceErrorMessage(response), response.status)
          ),
        },
      };
    }

    const audioBlob = await response.blob();
    return {
      ok: true,
      data: {
        audioBlob,
        contentType: response.headers.get('Content-Type') || audioBlob.type || 'audio/mpeg',
        language: response.headers.get('X-TTS-Language'),
        voiceName: response.headers.get('X-TTS-Voice'),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeVoiceApiError(error),
    };
  }
}

export async function syncAmbientListeningAudio(
  audio: Blob,
  options?: { sourcePage?: string; sourceSessionKey?: string }
): Promise<VoiceApiResult<AmbientListeningPayload>> {
  const formData = new FormData();
  formData.append('audio', audio, 'ambient-listening.webm');
  if (options?.sourcePage) formData.append('sourcePage', options.sourcePage);
  if (options?.sourceSessionKey) formData.append('sourceSessionKey', options.sourceSessionKey);
  return withVoiceForm('/api/voice/ambient-listening-audio', formData, normalizeAmbientListeningPayload);
}

export async function finalizeAmbientListeningSession(
  startedAt: string,
  options?: { sourceSessionKey?: string }
): Promise<VoiceApiResult<AmbientListeningFinalizePayload>> {
  return withVoiceJson(
    '/api/voice/ambient-listening-finalize',
    {
      startedAt,
      sourceSessionKey: options?.sourceSessionKey || '',
    },
    (payload) => payload
  );
}

export function getVoiceApiErrorMessage(
  error: VoiceApiError,
  context: 'speech-input' | 'voice-call' | 'ambient-listening' | 'tts',
  language: AppLanguage = 'zh-CN',
) {
  if (context === 'ambient-listening' && error.code === 'no_speech') {
    return '';
  }

  switch (error.code) {
    case 'unauthorized':
      return translateText(language, '登录状态失效，请刷新后重试。');
    case 'payload_too_large':
      return getPayloadTooLargeMessage(context, language);
    case 'no_speech':
      return context === 'ambient-listening' ? '' : translateText(language, '没有识别到有效语音，请再试一次。');
    case 'rate_limited':
      return translateText(language, '语音服务当前较忙，请稍后再试。');
    case 'timeout':
      return getTimeoutMessage(context, language);
    case 'network':
      return getNetworkMessage(context, language);
    case 'validation':
      return error.message || translateText(language, '语音请求参数有误，请重试。');
    case 'server':
    case 'unknown':
    default:
      return getDefaultVoiceErrorMessage(context, language);
  }
}

async function withVoiceForm<T>(path: string, formData: FormData, normalize?: (value: T) => T): Promise<VoiceApiResult<T>> {
  try {
    const data = await postForm<T>(path, formData);
    return { ok: true, data: normalize ? normalize(data) : data };
  } catch (error) {
    return { ok: false, error: normalizeVoiceApiError(error) };
  }
}

async function withVoiceJson<T>(path: string, body: unknown, normalize?: (value: T) => T): Promise<VoiceApiResult<T>> {
  try {
    const data = await postJsonOrThrow<T>(path, body);
    return { ok: true, data: normalize ? normalize(data) : data };
  } catch (error) {
    return { ok: false, error: normalizeVoiceApiError(error) };
  }
}

function getCurrentAppLanguage(): AppLanguage {
  return useStore.getState().language || 'zh-CN';
}

function normalizeTextForCurrentLanguage(value: string) {
  return normalizeChineseScript(value, getCurrentAppLanguage()).trim();
}

function normalizeTranscriptPayload(payload: VoiceTranscriptPayload): VoiceTranscriptPayload {
  return {
    ...payload,
    text: normalizeTextForCurrentLanguage(String(payload?.text || '')),
  };
}

function normalizeVoiceTurnPayload(payload: VoiceTurnPayload): VoiceTurnPayload {
  return {
    ...payload,
    transcript: normalizeTextForCurrentLanguage(String(payload?.transcript || '')),
  };
}

function normalizeAmbientListeningPayload(payload: AmbientListeningPayload): AmbientListeningPayload {
  return {
    ...payload,
    transcript: payload?.transcript ? normalizeTextForCurrentLanguage(String(payload.transcript)) : payload?.transcript,
  };
}

function normalizeVoiceApiError(error: unknown): VoiceApiError {
  if (error instanceof ApiError) {
    const status = error.status;
    const code = mapVoiceStatusToCode(status);
    return {
      code,
      message: error.message || 'Voice request failed',
    };
  }

  const message = String(
    (error as { message?: string; name?: string } | null)?.message
    || (error as { toString?: () => string } | null)?.toString?.()
    || 'Voice request failed'
  );
  const normalizedMessage = message.toLowerCase();
  const code: VoiceApiErrorCode = (
    (error as { name?: string } | null)?.name === 'AbortError'
    || normalizedMessage.includes('timeout')
  )
    ? 'timeout'
    : error instanceof TypeError
      ? 'network'
      : 'unknown';

  return {
    code,
    message,
  };
}

function mapVoiceStatusToCode(status?: number): VoiceApiErrorCode {
  if (status === 400 || status === 404) return 'validation';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 413) return 'payload_too_large';
  if (status === 422) return 'no_speech';
  if (status === 429) return 'rate_limited';
  if (status === 408) return 'timeout';
  if (typeof status === 'number' && status >= 500) return 'server';
  return 'unknown';
}

function getPayloadTooLargeMessage(context: 'speech-input' | 'voice-call' | 'ambient-listening' | 'tts', language: AppLanguage) {
  if (context === 'ambient-listening') {
    return translateText(language, '后台监听音频片段过大，请缩短采集窗口。');
  }
  return translateText(language, '录音太长，超过当前语音上传限制，请缩短后重试。');
}

function getTimeoutMessage(context: 'speech-input' | 'voice-call' | 'ambient-listening' | 'tts', language: AppLanguage) {
  if (context === 'tts') {
    return translateText(language, '语音播报超时，已回退到系统朗读。');
  }
  return translateText(language, '语音服务响应超时，请缩短内容后重试。');
}

function getNetworkMessage(context: 'speech-input' | 'voice-call' | 'ambient-listening' | 'tts', language: AppLanguage) {
  switch (context) {
    case 'ambient-listening':
      return translateText(language, '后台监听音频同步失败，请检查网络连接。');
    case 'voice-call':
      return translateText(language, '语音通话失败，请检查网络连接后重试。');
    case 'tts':
      return translateText(language, '语音播报失败，已回退到系统朗读。');
    case 'speech-input':
    default:
      return translateText(language, '语音转写失败，请检查网络连接后重试。');
  }
}

function getDefaultVoiceErrorMessage(context: 'speech-input' | 'voice-call' | 'ambient-listening' | 'tts', language: AppLanguage) {
  switch (context) {
    case 'voice-call':
      return translateText(language, '语音通话失败，请稍后重试。');
    case 'ambient-listening':
      return translateText(language, '后台监听音频同步失败。');
    case 'tts':
      return translateText(language, '语音播报失败，已回退到系统朗读。');
    case 'speech-input':
    default:
      return translateText(language, '语音转写失败，请再试一次。');
  }
}

async function readVoiceErrorMessage(response: Response) {
  try {
    const payload = await response.json();
    if (payload && typeof payload === 'object' && 'error' in payload) {
      return String((payload as { error?: string }).error || `Request failed with ${response.status}`);
    }
  } catch {}
  return `Request failed with ${response.status}`;
}
