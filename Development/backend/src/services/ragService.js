const axios = require('axios');

const SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://127.0.0.1:8010';
const SERVICE_EXPERT = process.env.RAG_SERVICE_EXPERT || 'li_songwei';
const HEALTH_TIMEOUT_MS = parseInt(process.env.RAG_SERVICE_HEALTH_TIMEOUT_MS || '1500', 10);
const QUERY_TIMEOUT_MS = parseInt(process.env.RAG_SERVICE_QUERY_TIMEOUT_MS || '45000', 10);
const SUPPORT_GUIDANCE_TIMEOUT_MS = parseInt(
  process.env.RAG_SUPPORT_GUIDANCE_TIMEOUT_MS || process.env.RAG_SERVICE_QUERY_TIMEOUT_MS || '10000',
  10
);

function normalizeServiceError(error, fallbackMessage) {
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
  try {
    await axios.get(`${SERVICE_URL}/health`, {
      timeout: HEALTH_TIMEOUT_MS,
      proxy: false,
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureServiceReady() {
  const ready = await isServiceHealthy();
  if (!ready) {
    throw new Error(`RAG container service is unavailable at ${SERVICE_URL}`);
  }
  return true;
}

async function warmupDigitalExpertService() {
  return ensureServiceReady();
}

async function queryDigitalExpert(query, expert = SERVICE_EXPERT, options = {}) {
  await ensureServiceReady();

  try {
    const response = await axios.post(
      `${SERVICE_URL}/query`,
      {
        text: query,
        expert,
        memory_context: options.memoryContext || '',
        recent_messages: Array.isArray(options.recentMessages) ? options.recentMessages : [],
      },
      {
        timeout: QUERY_TIMEOUT_MS,
        proxy: false,
      }
    );

    console.log(
      `[RAG Service] query expert=${response.data.expert} elapsed=${response.data.elapsed}s module=${response.data.support?.selected_module_id || 'none'} risk=${response.data.support?.risk_level || 'low'}`
    );
    return response.data.answer;
  } catch (error) {
    throw normalizeServiceError(error, 'RAG query failed');
  }
}

async function fetchSupportGuidance({
  query,
  memoryContext = '',
  recentMessages = [],
  retrievalIntent = 'general_support',
  userStance = 'neutral',
}) {
  await ensureServiceReady();

  try {
    const response = await axios.post(
      `${SERVICE_URL}/support/guide`,
      {
        text: query,
        memory_context: memoryContext,
        recent_messages: Array.isArray(recentMessages) ? recentMessages : [],
        retrieval_intent: retrievalIntent,
        user_stance: userStance,
      },
      {
        timeout: SUPPORT_GUIDANCE_TIMEOUT_MS,
        proxy: false,
      }
    );
    return response.data;
  } catch (error) {
    throw normalizeServiceError(error, 'RAG support guidance failed');
  }
}

module.exports = {
  warmupDigitalExpertService,
  queryDigitalExpert,
  fetchSupportGuidance,
};
