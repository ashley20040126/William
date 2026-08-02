const axios = require('axios');
const { getProxyForUrl } = require('proxy-from-env');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const OPENAI_TTS_VOICE_ZH = process.env.OPENAI_TTS_VOICE_ZH || 'verse';
const OPENAI_TTS_VOICE_EN = process.env.OPENAI_TTS_VOICE_EN || 'sage';
const OPENAI_TTS_RESPONSE_FORMAT = process.env.OPENAI_TTS_RESPONSE_FORMAT || 'mp3';
const OPENAI_TTS_TIMEOUT_MS = parseInt(process.env.OPENAI_TTS_TIMEOUT_MS || '45000', 10);
const OPENAI_TTS_INSTRUCTIONS_ZH = process.env.OPENAI_TTS_INSTRUCTIONS_ZH
  || 'Speak in warm, calm, natural Mandarin Chinese. Keep a medium-slow pace with gentle pauses. Sound grounded, thoughtful, and conversational. Avoid sounding robotic, salesy, exaggerated, or overly cheerful.';
const OPENAI_TTS_INSTRUCTIONS_EN = process.env.OPENAI_TTS_INSTRUCTIONS_EN
  || 'Speak in a warm, calm, natural tone. Keep a medium-slow pace with gentle pauses. Sound grounded, thoughtful, and conversational. Avoid sounding robotic, salesy, exaggerated, or overly cheerful.';

function ensureOpenAiTtsConfigured() {
  if (!OPENAI_API_KEY) {
    const error = new Error('OpenAI TTS is not configured');
    error.statusCode = 503;
    throw error;
  }
}

function detectLanguage(text) {
  return /[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : 'en-US';
}

function pickVoiceName(language) {
  return language.startsWith('zh') ? OPENAI_TTS_VOICE_ZH : OPENAI_TTS_VOICE_EN;
}

function buildProxyConfig(targetUrl) {
  const proxyUrl = getProxyForUrl(targetUrl);
  if (!proxyUrl) return { proxy: false };

  const parsed = new URL(proxyUrl);
  return {
    proxy: {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port: Number(parsed.port),
    },
  };
}

async function synthesizeSpeech(text, options = {}) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) {
    const error = new Error('Text required for speech synthesis');
    error.statusCode = 400;
    throw error;
  }

  ensureOpenAiTtsConfigured();
  const language = options.language || detectLanguage(normalizedText);
  const voiceName = options.voiceName || pickVoiceName(language);
  const instructions = options.instructions
    || (language.startsWith('zh') ? OPENAI_TTS_INSTRUCTIONS_ZH : OPENAI_TTS_INSTRUCTIONS_EN);

  const endpoint = `${OPENAI_BASE_URL.replace(/\/$/, '')}/audio/speech`;
  let response;
  try {
    response = await axios.post(endpoint, {
      model: OPENAI_TTS_MODEL,
      voice: voiceName,
      input: normalizedText,
      instructions,
      response_format: OPENAI_TTS_RESPONSE_FORMAT,
    }, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout: OPENAI_TTS_TIMEOUT_MS,
      ...buildProxyConfig(endpoint),
    });
  } catch (error) {
    const detail = extractUpstreamError(error);
    if (detail) {
      error.message = detail;
    }
    throw error;
  }

  return {
    audioBuffer: Buffer.from(response.data),
    contentType: response.headers['content-type'] || inferAudioContentType(OPENAI_TTS_RESPONSE_FORMAT),
    language,
    voiceName,
  };
}

function extractUpstreamError(error) {
  if (error.response?.data) {
    try {
      const payload = JSON.parse(Buffer.from(error.response.data).toString('utf8'));
      if (payload?.error?.message) {
        return payload.error.message;
      }
    } catch {}
  }
  if (error.code === 'ECONNABORTED') {
    return `OpenAI TTS request timed out after ${OPENAI_TTS_TIMEOUT_MS}ms`;
  }
  return '';
}

function inferAudioContentType(format) {
  switch (format) {
    case 'wav':
      return 'audio/wav';
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    case 'opus':
      return 'audio/opus';
    case 'pcm':
      return 'audio/pcm';
    case 'mp3':
    default:
      return 'audio/mpeg';
  }
}

module.exports = {
  synthesizeSpeech,
};
