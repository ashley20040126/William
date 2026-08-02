'use strict';

/**
 * storyGeneratorService.js
 * Causal Intelligence Layer — generates daily 4-panel narrative stories.
 * Aggregates signals from day_profiles, journals, schedule_candidates, and
 * practice_completions, then uses LLM to synthesize a human-readable storyboard.
 *
 * Image generation requires the user's own OpenAI API key from Settings.
 * Without a user key, story panels fall back to the default artwork cards.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('../utils/db');
const { getProxyForUrl } = require('proxy-from-env');
const { safeJsonParse } = require('./userServiceUtils');

// ── LLM (text generation) config ─────────────────────────────────────────────
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const TIMEOUT_MS = parseInt(process.env.STORY_GEN_TIMEOUT_MS || '30000', 10);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// ── OpenAI image generation config ───────────────────────────────────────────
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const OPENAI_IMAGE_TIMEOUT_MS = parseInt(process.env.OPENAI_IMAGE_TIMEOUT_MS || '60000', 10);
const OPENAI_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || '1024x1024';

// Directory where generated story images are saved and served
const STORIES_DIR = path.join(__dirname, '../../uploads/stories');

const IMAGE_FALLBACK_REASON = {
  MISSING_API_KEY: 'missing_api_key',
  QUOTA_EXCEEDED: 'quota_exceeded',
  REQUEST_FAILED: 'request_failed',
};
let ensuredStoryColumnsPromise = null;

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

/**
 * Get or generate the daily story for a user on the given date.
 * Returns cached result if already generated for that day.
 * @param {number} userId
 * @param {string} dateKey  'YYYY-MM-DD'
 * @returns {Promise<{panels: Array, date: string, fromCache: boolean}>}
 */
async function getDailyStory(userId, dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    const err = new Error('Invalid date format; expected YYYY-MM-DD');
    err.statusCode = 400;
    throw err;
  }

  // Return cached story if available
  const [cached] = await db.execute(
    'SELECT panels FROM daily_stories WHERE user_id = ? AND date_key = ?',
    [userId, dateKey]
  );
  if (cached.length > 0) {
    const cachedPanels = safeJsonParse(cached[0].panels, []);
    if (await shouldBackfillCachedStoryImages(cachedPanels, userId)) {
      const imageApiKey = await getUserStoryOpenAIKey(userId);
      const hydratedPanels = await addImagesToPanels(cachedPanels, userId, dateKey, imageApiKey);
      await db.execute(
        `UPDATE daily_stories
         SET panels = ?
         WHERE user_id = ? AND date_key = ?`,
        [JSON.stringify(hydratedPanels), userId, dateKey]
      );
      return { panels: hydratedPanels, date: dateKey, fromCache: false };
    }
    return { panels: cachedPanels, date: dateKey, fromCache: true };
  }

  const signals = await gatherDaySignals(userId, dateKey);
  const panels = await generatePanels(signals, userId, dateKey);

  // Persist (ignore duplicates from concurrent requests)
  await db.execute(
    `INSERT INTO daily_stories (user_id, date_key, panels)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE panels = VALUES(panels)`,
    [userId, dateKey, JSON.stringify(panels)]
  );

  return { panels, date: dateKey, fromCache: false };
}

/**
 * Get the last N daily stories for a user (newest first).
 * Generates missing stories lazily for each day in the range.
 * @param {number} userId
 * @param {number} days
 * @returns {Promise<Array<{panels, date, fromCache}>>}
 */
async function getRecentStories(userId, days = 7) {
  const results = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    try {
      const story = await getDailyStory(userId, dateKey);
      results.push(story);
    } catch {
      // skip days with errors
    }
  }
  return results;
}

// ── Signal aggregation ───────────────────────────────────────────────────────

async function gatherDaySignals(userId, dateKey) {
  const [[profiles], [journals], [schedules], [practices]] = await Promise.all([
    db.execute(
      `SELECT composite_stress, composite_mood, ambient_stress_avg, ambient_stress_peak,
              chat_emotions, chat_topics, practices_done, practice_count,
              journal_topics, journal_patterns
       FROM day_profiles WHERE user_id = ? AND date = ?`,
      [userId, dateKey]
    ),
    db.execute(
      'SELECT text_content FROM journals WHERE user_id = ? AND entry_date = ?',
      [userId, dateKey]
    ),
    db.execute(
      `SELECT title FROM schedule_candidates
       WHERE user_id = ? AND DATE(COALESCE(start_time, created_at)) = ?
         AND status IN ('confirmed','edited')
       ORDER BY start_time ASC LIMIT 5`,
      [userId, dateKey]
    ),
    db.execute(
      `SELECT practice_id FROM practice_completions
       WHERE user_id = ? AND DATE(completed_at) = ?`,
      [userId, dateKey]
    ),
  ]);

  const p = profiles[0] || {};
  const j = journals[0] || {};

  return {
    date: dateKey,
    stress: p.composite_stress != null ? parseFloat(p.composite_stress) : null,
    mood: p.composite_mood != null ? parseFloat(p.composite_mood) : null,
    ambientStress: p.ambient_stress_avg != null ? parseFloat(p.ambient_stress_avg) : null,
    ambientPeak: p.ambient_stress_peak != null ? parseFloat(p.ambient_stress_peak) : null,
    emotions: safeJsonParse(p.chat_emotions, []),
    topics: safeJsonParse(p.chat_topics, []),
    journalTopics: safeJsonParse(p.journal_topics, []),
    patterns: safeJsonParse(p.journal_patterns, []),
    journalExcerpt: j.text_content ? String(j.text_content).slice(0, 300) : null,
    schedules: schedules.map((s) => s.title),
    practices: practices.map((p2) => p2.practice_id),
    practiceCount: parseInt(p.practice_count || '0', 10),
  };
}

// ── Panel generation ─────────────────────────────────────────────────────────

async function generatePanels(signals, userId, dateKey) {
  const fallback = buildFallbackPanels(signals);
  const imageApiKey = await getUserStoryOpenAIKey(userId);
  if (!OPENAI_API_KEY) return addImagesToPanels(fallback, userId, dateKey, imageApiKey);

  try {
    const endpoint = `${BASE_URL.replace(/\/$/, '')}/chat/completions`;
    const completion = await axios.post(
      endpoint,
      {
        model: MODEL,
        messages: [{ role: 'user', content: buildStoryPrompt(signals) }],
        response_format: { type: 'json_object' },
        max_tokens: 600,
        temperature: 0.7,
      },
      {
        timeout: TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        ...buildProxyConfig(endpoint),
      }
    );
    const raw = completion.data?.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.panels) && parsed.panels.length === 4) {
      const textPanels = parsed.panels.map((panel) => ({
        type: String(panel.type || 'trigger'),
        title: String(panel.title || ''),
        text: String(panel.text || ''),
        signal_source: String(panel.signal_source || 'william'),
      }));
      return addImagesToPanels(textPanels, userId, dateKey, imageApiKey);
    }
    return addImagesToPanels(fallback, userId, dateKey, imageApiKey);
  } catch (err) {
    console.warn('[StoryGenerator] LLM failed, using fallback:', err.message);
    return addImagesToPanels(fallback, userId, dateKey, imageApiKey);
  }
}

function buildStoryPrompt(signals) {
  return `你是 William 情绪操作系统的叙事引擎。根据以下用户当天的信号数据，生成一张温暖、具体的"情绪故事卡"，包含 4 格内容。

日期: ${signals.date}
压力值: ${signals.stress ?? '无数据'} (1-10)
环境压力均值: ${signals.ambientStress ?? '无'}，峰值: ${signals.ambientPeak ?? '无'}
心情: ${signals.mood ?? '无'}
当日日程: ${signals.schedules.length > 0 ? signals.schedules.join('、') : '无'}
聊天话题: ${signals.topics.length > 0 ? signals.topics.slice(0, 3).join('、') : '无'}
日记摘录: ${signals.journalExcerpt || '无'}
完成练习: ${signals.practiceCount} 项${signals.practices.length > 0 ? `（${signals.practices.join('、')}）` : ''}

请生成以下 4 格的 JSON，每格包含 type、title、text、signal_source：
- 格1 type=trigger，title="诱因"：是什么事件/信号触发了当日情绪状态？
- 格2 type=state，title="身心反应"：当天的压力/情绪状态如何体现？
- 格3 type=action，title="干预行动"：用户做了什么来应对？William 提供了什么支持？
- 格4 type=resolution，title="恢复结果"：干预后的变化，以一句温暖的鼓励结尾。

要求：每格 text 不超过 40 字，文案自然温暖，基于真实信号，避免模板化。
返回格式: {"panels": [{type, title, text, signal_source}, ...]}`;
}

function buildImagePrompt(panel) {
  const stylePrefix = '简约温暖插画风格，柔和色调，无文字，正方形构图，情绪可视化，';
  const contextMap = {
    trigger:    '触发场景：',
    state:      '内心状态：',
    action:     '积极行动：',
    resolution: '平静恢复：',
  };
  const ctx = contextMap[panel.type] || '';
  return stylePrefix + ctx + panel.text.slice(0, 60);
}

/**
 * Generate a single image via OpenAI and save it to disk.
 * Returns the public URL path, or null on failure.
 * @param {string} prompt
 * @param {string} filename  e.g. "123_2025-01-01_trigger.jpg"
 * @returns {Promise<string|null>}
 */
async function generateImageWithOpenAI(prompt, filename, apiKey) {
  const endpoint = `${BASE_URL.replace(/\/$/, '')}/images/generations`;
  const response = await axios.post(
    endpoint,
    {
      model: OPENAI_IMAGE_MODEL,
      prompt,
      size: OPENAI_IMAGE_SIZE,
    },
    {
      timeout: OPENAI_IMAGE_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      ...buildProxyConfig(endpoint),
    }
  );

  const imageBase64 = extractOpenAIBase64Image(response.data);
  if (!imageBase64) {
    const detail = response?.data ? JSON.stringify(response.data).slice(0, 200) : 'no b64_json returned';
    throw new Error(`Model ${OPENAI_IMAGE_MODEL} returned ${detail}`);
  }

  if (!fs.existsSync(STORIES_DIR)) {
    fs.mkdirSync(STORIES_DIR, { recursive: true });
  }

  const filePath = path.join(STORIES_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(imageBase64, 'base64'));
  return `/uploads/stories/${filename}`;
}

async function addImagesToPanels(panels, userId, dateKey, imageApiKey = '') {
  if (!imageApiKey) {
    return panels.map((panel) => (
      panel?.image_url
        ? panel
        : { ...panel, image_fallback_reason: panel?.image_fallback_reason || IMAGE_FALLBACK_REASON.MISSING_API_KEY }
    ));
  }

  const nextPanels = [];
  let quotaExceeded = false;

  for (const panel of panels) {
    if (quotaExceeded) {
      nextPanels.push({
        ...panel,
        image_fallback_reason: IMAGE_FALLBACK_REASON.QUOTA_EXCEEDED,
      });
      continue;
    }

    try {
      const filename = `${userId}_${dateKey}_${panel.type}.jpg`;
      const imageUrl = await generateImageWithOpenAI(buildImagePrompt(panel), filename, imageApiKey);
      nextPanels.push(imageUrl ? { ...panel, image_url: imageUrl } : panel);
    } catch (err) {
      const classified = classifyOpenAIImageError(err);
      console.warn(
        `[StoryGenerator] OpenAI image generation failed for panel "${panel.type}" with model "${OPENAI_IMAGE_MODEL}" (${classified.kind}): ${classified.message}`
      );

      if (classified.kind === IMAGE_FALLBACK_REASON.QUOTA_EXCEEDED) {
        quotaExceeded = true;
      }

      nextPanels.push({
        ...panel,
        image_fallback_reason: classified.kind,
      });
    }
  }

  if (quotaExceeded) {
    console.warn(
      `[StoryGenerator] OpenAI image generation quota unavailable for model "${OPENAI_IMAGE_MODEL}". Remaining panels were downgraded to text-only cards.`
    );
  }

  return nextPanels;
}

function classifyOpenAIImageError(err) {
  const status = typeof err?.status === 'number' ? err.status : typeof err?.code === 'number' ? err.code : null;
  const rawMessage = extractOpenAIErrorDetail(err) || String(err?.message || err || '');

  if (status === 429 || /quota|rate limit|insufficient_quota/i.test(rawMessage)) {
    return { kind: IMAGE_FALLBACK_REASON.QUOTA_EXCEEDED, message: rawMessage };
  }

  return { kind: IMAGE_FALLBACK_REASON.REQUEST_FAILED, message: rawMessage };
}

function extractOpenAIBase64Image(payload) {
  const images = payload?.data;
  if (Array.isArray(images) && typeof images[0]?.b64_json === 'string' && images[0].b64_json) {
    return images[0].b64_json;
  }
  return null;
}

function extractOpenAIErrorDetail(err) {
  if (!err) return '';
  if (err?.error?.message) return String(err.error.message);
  if (err?.response?.data?.error?.message) return String(err.response.data.error.message);
  if (err?.message) return String(err.message);
  return '';
}

function buildFallbackPanels(signals) {
  const s = signals.stress;
  const isHigh = s != null && s >= 7;
  const isMid = s != null && s >= 4;

  const triggerText = signals.schedules.length > 0
    ? `「${signals.schedules[0]}」等日程安排带来了不小的挑战。`
    : signals.topics.length > 0
      ? `围绕「${signals.topics[0]}」的思绪较为活跃。`
      : '这一天从平静中开始，没有明显的外部触发。';

  const stateText = isHigh
    ? `压力攀升至 ${s}，身体和思绪都在高速运转。`
    : isMid
      ? `情绪有些起伏，压力维持在 ${s} 的中等水平。`
      : s != null
        ? `整体状态平稳，压力值 ${s}，身心保持在平衡区间。`
        : '今日情绪数据待记录，无法完整描述状态。';

  const actionText = signals.practiceCount > 0
    ? `完成了 ${signals.practiceCount} 项调节练习，主动为自己创造了喘息空间。`
    : '与 William 进行了对话，探索和整理了当下的感受。';

  const resolutionText = isHigh
    ? '高压之后，你选择了面对而非逃避——这已经是很大的勇气。'
    : isMid
      ? '即使情绪有波动，你依然在照顾自己。这种觉察本身就是进步。'
      : '今天的平静，是长期努力累积的结果。继续保持。';

  return [
    {
      type: 'trigger',
      title: '诱因',
      text: triggerText,
      signal_source: signals.schedules.length > 0 ? 'calendar' : 'chat',
    },
    {
      type: 'state',
      title: '身心反应',
      text: stateText,
      signal_source: 'day_profile',
    },
    {
      type: 'action',
      title: '干预行动',
      text: actionText,
      signal_source: 'practice_completions',
    },
    {
      type: 'resolution',
      title: '恢复结果',
      text: resolutionText,
      signal_source: 'william',
    },
  ];
}

async function shouldBackfillCachedStoryImages(panels, userId) {
  const imageApiKey = await getUserStoryOpenAIKey(userId);
  if (!imageApiKey) return false;
  if (!Array.isArray(panels) || panels.length === 0) return false;
  return panels.some((panel) =>
    !panel?.image_url && (!panel?.image_fallback_reason || panel?.image_fallback_reason === IMAGE_FALLBACK_REASON.MISSING_API_KEY)
  );
}

async function getUserStoryOpenAIKey(userId) {
  await ensureStoryColumns();
  const [rows] = await db.execute(
    'SELECT story_openai_api_key FROM users WHERE id = ? LIMIT 1',
    [userId]
  );
  return String(rows?.[0]?.story_openai_api_key || '').trim();
}

async function ensureStoryColumns() {
  if (!ensuredStoryColumnsPromise) {
    ensuredStoryColumnsPromise = db.execute("SHOW COLUMNS FROM users LIKE 'story_openai_api_key'")
      .then(async ([rows]) => {
        if (rows.length > 0) return;
        await db.query("ALTER TABLE users ADD COLUMN story_openai_api_key TEXT NULL AFTER ambient_asr_enabled");
      })
      .catch((error) => {
        ensuredStoryColumnsPromise = null;
        throw error;
      });
  }
  return ensuredStoryColumnsPromise;
}

module.exports = { getDailyStory, getRecentStories };
