const axios = require('axios');

const SERVICE_URL = process.env.VOICE_SERVICE_URL || 'http://127.0.0.1:8020';
const HEALTH_TIMEOUT_MS = parseInt(process.env.VOICE_SERVICE_HEALTH_TIMEOUT_MS || '1500', 10);
const TRANSCRIBE_TIMEOUT_MS = parseInt(process.env.VOICE_SERVICE_TRANSCRIBE_TIMEOUT_MS || '45000', 10);
const ANALYZE_TIMEOUT_MS = parseInt(process.env.VOICE_SERVICE_ANALYZE_TIMEOUT_MS || '45000', 10);
const HEALTH_CACHE_MS = parseInt(process.env.VOICE_SERVICE_HEALTH_CACHE_MS || '10000', 10);

let lastHealthyAt = 0;

function createUpstreamServiceError(error, fallbackMessage) {
  const detail = error?.response?.data?.detail
    || error?.response?.data?.error
    || error?.message
    || fallbackMessage;
  const wrapped = new Error(detail);
  wrapped.statusCode = error?.response?.status || error?.statusCode || 500;
  wrapped.cause = error;
  return wrapped;
}

async function isServiceHealthy() {
  if (lastHealthyAt && Date.now() - lastHealthyAt < HEALTH_CACHE_MS) {
    return true;
  }

  try {
    await axios.get(`${SERVICE_URL}/health`, {
      timeout: HEALTH_TIMEOUT_MS,
      proxy: false,
    });
    lastHealthyAt = Date.now();
    return true;
  } catch {
    return false;
  }
}

async function ensureServiceReady() {
  const ready = await isServiceHealthy();
  if (!ready) {
    throw new Error(`Voice container service is unavailable at ${SERVICE_URL}`);
  }
  return true;
}

async function warmupVoiceService() {
  return ensureServiceReady();
}

async function transcribeAudioBuffer(buffer, options = {}) {
  await ensureServiceReady();

  const payload = {
    audio_base64: Buffer.from(buffer).toString('base64'),
    filename: options.filename || 'voice.webm',
    mime_type: options.mimeType || 'audio/webm',
  };

  try {
    const response = await axios.post(`${SERVICE_URL}/transcribe`, payload, {
      timeout: options.timeoutMs || TRANSCRIBE_TIMEOUT_MS,
      proxy: false,
    });
    lastHealthyAt = Date.now();
    return response.data;
  } catch (error) {
    throw createUpstreamServiceError(error, 'Voice transcription failed');
  }
}

async function analyzeAudioBuffer(buffer, options = {}) {
  await ensureServiceReady();

  const payload = {
    audio_base64: Buffer.from(buffer).toString('base64'),
    filename: options.filename || 'ambient.webm',
    mime_type: options.mimeType || 'audio/webm',
    skip_transcription: Boolean(options.skipTranscription),
  };

  try {
    const response = await axios.post(`${SERVICE_URL}/analyze`, payload, {
      timeout: options.timeoutMs || ANALYZE_TIMEOUT_MS,
      proxy: false,
    });
    lastHealthyAt = Date.now();
    return response.data;
  } catch (error) {
    throw createUpstreamServiceError(error, 'Voice analysis failed');
  }
}

module.exports = {
  warmupVoiceService,
  transcribeAudioBuffer,
  analyzeAudioBuffer,
};
