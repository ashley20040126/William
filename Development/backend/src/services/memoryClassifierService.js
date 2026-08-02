const axios = require('axios');
const { getProxyForUrl } = require('proxy-from-env');

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MEMORY_CLASSIFIER_TIMEOUT_MS = parseInt(process.env.MEMORY_CLASSIFIER_TIMEOUT_MS || '8000', 10);
const CLASSIFIER_VERSION = 'memory_classifier_v1';

const ALLOWED_MEMORY_TYPES = new Set([
  'goal',
  'preference',
  'relationship',
  'support_style',
  'trigger',
  'problem_pattern',
  'action_history',
  'emotional_state',
]);

const ALLOWED_ACTIVE_LOOP_TYPES = new Set([
  'goal_process',
  'difficult_conversation',
  'sleep_recovery',
  'upcoming_commitment',
  'emotional_cycle',
]);

async function classifyMemorySentences({ sentences = [], mode = 'classic' }) {
  const normalizedSentences = (Array.isArray(sentences) ? sentences : [])
    .map((item, index) => ({
      id: item?.id || `s${index + 1}`,
      text: normalizeText(item?.text || ''),
    }))
    .filter((item) => item.text);

  if (normalizedSentences.length === 0) {
    return {
      status: 'skipped',
      version: CLASSIFIER_VERSION,
      results: [],
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      status: 'unavailable',
      version: CLASSIFIER_VERSION,
      results: [],
    };
  }

  const endpoint = `${OPENAI_BASE_URL}/chat/completions`;
  const prompt = buildClassifierPrompt({ sentences: normalizedSentences, mode });

  try {
    const response = await axios.post(
      endpoint,
      {
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: 'You are a strict JSON memory classifier. Return valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 800,
        response_format: { type: 'json_object' },
      },
      {
        timeout: MEMORY_CLASSIFIER_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        ...buildProxyConfig(endpoint),
      }
    );

    const raw = response.data?.choices?.[0]?.message?.content || '{}';
    const parsed = safeParse(raw, {});
    return {
      status: 'success',
      version: CLASSIFIER_VERSION,
      results: normalizeClassifierResults(parsed.results, normalizedSentences),
    };
  } catch {
    return {
      status: 'error',
      version: CLASSIFIER_VERSION,
      results: [],
    };
  }
}

function buildClassifierPrompt({ sentences = [], mode = 'classic' }) {
  return [
    '你是 William 的长期记忆分类器。你的任务是判断每个用户句子是否值得写入长期记忆或 active loop。',
    '只返回 JSON，不要返回解释。',
    '输出格式：{"results":[{"id":"s1","items":[{"kind":"memory|active_loop","memoryType":"","activeLoopType":"","summary":"","confidence":0.0,"sensitivity":"low|medium|high","needsUserConfirmation":false,"reason":""}]}]}',
    '规则：',
    '- 只提取对未来多轮帮助明显的稳定事实或正在进行中的事项。',
    '- 不要记录短暂情绪、泛泛抱怨、单次想法、模糊愿望。',
    '- memory 适合长期稳定事实，例如目标、关系议题、支持偏好、触发模式、长期情绪负荷。',
    '- active_loop 适合正在推进或反复卡住的事项，例如准备某件事、困难对话、睡眠恢复、临近事项。',
    '- 一句话可以产出多个 item，但最多 2 个。',
    '- summary 必须自然、简洁、面向 William 内部记忆，不要抄原句，不要写成模板术语。',
    '- 对敏感内容更保守；如果不确定，返回空 items。',
    '- support_style 只在用户明确表达沟通偏好时使用。',
    '- emotional_state 只在句子表达了持续性的情绪负荷时使用。',
    '- 当一句话同时包含“长期稳定事实”和“正在进行中的事项”时，应同时输出 memory 和 active_loop。',
    '- 不要把“我试过/我已经试过/我后来试过”这类历史尝试误判成 goal_process。',
    '- 对“每次/一想到/只要...就...”这类表达，优先考虑 trigger，而不是 emotional_state。',
    `当前模式: ${mode}`,
    `允许的 memoryType: ${[...ALLOWED_MEMORY_TYPES].join(', ')}`,
    `允许的 activeLoopType: ${[...ALLOWED_ACTIVE_LOOP_TYPES].join(', ')}`,
    '',
    '示例：',
    '- 句子: 我最近一直卡在怎么跟妈妈开口说我想辞职。',
    '  输出: relationship memory + goal memory + difficult_conversation active_loop',
    '- 句子: 我最近在准备产品经理面试，已经开始刷题和改简历。',
    '  输出: goal memory + goal_process active_loop',
    '- 句子: 你直接一点，别安慰我，给我结论。',
    '  输出: support_style memory',
    '- 句子: 每次一想到周会发言我就会心慌。',
    '  输出: trigger memory，不要输出 emotional_state',
    '- 句子: 我试过把任务拆小，也试过早点睡，但后来都没坚持住。',
    '  输出: action_history memory，不要输出 active_loop',
    '',
    '句子列表：',
    ...sentences.map((item) => `${item.id}: ${item.text}`),
  ].join('\n');
}

function normalizeClassifierResults(results, sentences) {
  const sentenceMap = new Map(sentences.map((item) => [item.id, item.text]));
  const rows = Array.isArray(results) ? results : [];

  return rows
    .map((row) => normalizeResultRow(row, sentenceMap))
    .filter(Boolean);
}

function normalizeResultRow(row, sentenceMap) {
  const id = String(row?.id || '').trim();
  if (!id || !sentenceMap.has(id)) return null;
  const items = (Array.isArray(row.items) ? row.items : [])
    .map((item) => normalizeResultItem(item))
    .filter(Boolean)
    .slice(0, 2);

  return {
    id,
    sentence: sentenceMap.get(id),
    items,
  };
}

function normalizeResultItem(item) {
  const kind = item?.kind === 'active_loop' ? 'active_loop' : item?.kind === 'memory' ? 'memory' : '';
  if (!kind) return null;

  const memoryType = cleanText(item.memoryType);
  const activeLoopType = cleanText(item.activeLoopType);
  if (kind === 'memory' && !ALLOWED_MEMORY_TYPES.has(memoryType)) return null;
  if (kind === 'active_loop' && !ALLOWED_ACTIVE_LOOP_TYPES.has(activeLoopType)) return null;

  const summary = cleanText(item.summary).slice(0, 220);
  if (!summary || summary.length < 4) return null;

  return {
    kind,
    memoryType: kind === 'memory' ? memoryType : '',
    activeLoopType: kind === 'active_loop' ? activeLoopType : '',
    summary,
    confidence: clampConfidence(item.confidence),
    sensitivity: normalizeSensitivity(item.sensitivity),
    needsUserConfirmation: Boolean(item.needsUserConfirmation),
    reason: cleanText(item.reason).slice(0, 64),
  };
}

function clampConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.65;
  return Number(Math.min(Math.max(parsed, 0), 0.98).toFixed(2));
}

function normalizeSensitivity(value) {
  const normalized = cleanText(value).toLowerCase();
  if (normalized === 'high' || normalized === 'medium') return normalized;
  return 'low';
}

function safeParse(value, fallback) {
  if (!value || typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeText(text) {
  return cleanText(String(text || '').replace(/\s+/g, ' '));
}

function cleanText(text) {
  return String(text || '').trim();
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

module.exports = {
  classifyMemorySentences,
  CLASSIFIER_VERSION,
};
