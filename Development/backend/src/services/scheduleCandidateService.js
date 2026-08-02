const axios = require('axios');
const { getProxyForUrl } = require('proxy-from-env');
const db = require('../utils/db');

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const SCHEDULE_EXTRACTION_TIMEOUT_MS = parseInt(process.env.SCHEDULE_EXTRACTION_TIMEOUT_MS || '8000', 10);

const PARTICIPANT_TERMS = [
  '妈妈', '母亲', '爸爸', '父亲', '爸妈', '父母', '家人', '伴侣', '男朋友', '女朋友',
  '老公', '老婆', '丈夫', '妻子', '对象', '朋友', '同事', '老板', '导师', '老师',
  '医生', '客户', '面试官', 'hr', 'HR',
];

const SPORT_TERMS = ['羽毛球', '篮球', '网球', '乒乓球', '排球', '足球'];

const EVENT_TERMS = [
  '开会', '见', '聊', '沟通', '讨论', '复诊', '复查', '看牙', '看医生', '面试', '上课',
  '吃饭', '喝咖啡', '提交', '汇报', '约', '出发', '飞', '出差', '去', '到', '参加',
  '训练', '健身', '打球', ...SPORT_TERMS, '跑步', '游泳', '爬山', '谈', '谈谈', 'review', 'meeting', 'interview', 'appointment',
];

const FUTURE_TIME_PATTERNS = [
  /今天|今晚|今早|今晨|明天|明早|明晚|后天|大后天|下周|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]/,
  /\d{1,2}月\d{1,2}日/,
  /\d{1,2}[\/.-]\d{1,2}/,
];

const HYPOTHETICAL_PATTERNS = [/如果/, /要是/, /假如/, /万一/, /是不是该/, /要不要/, /怎么办/];
const PAST_PATTERNS = [/昨天/, /前天/, /上周/, /上星期/, /之前/, /刚刚/, /那天/];
const EXPLICIT_SCHEDULE_REQUEST_PATTERN = /(帮我|帮忙|请|麻烦)?(把|将)?(.{0,8})?(加入|加到|添加到|放进|记到|安排到)(日程|行程|计划|calendar)|设(一个)?提醒/;

async function ensureScheduleCandidateSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schedule_candidates (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      session_id BIGINT UNSIGNED NOT NULL,
      source_message_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(255) NOT NULL,
      start_time DATETIME NULL,
      end_time DATETIME NULL,
      date_text VARCHAR(120),
      location VARCHAR(160),
      participants_json JSON,
      confidence DECIMAL(4,2) NOT NULL DEFAULT 0.50,
      status ENUM('candidate','confirmed','dismissed','edited') NOT NULL DEFAULT 'candidate',
      dedupe_key VARCHAR(255) NOT NULL,
      meta_json JSON,
      todo_status ENUM('pending','completed') NOT NULL DEFAULT 'pending',
      todo_completed_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      confirmed_at TIMESTAMP NULL DEFAULT NULL,
      dismissed_at TIMESTAMP NULL DEFAULT NULL,
      INDEX idx_schedule_user_status (user_id, status, updated_at),
      INDEX idx_schedule_session_status (session_id, status, updated_at),
      INDEX idx_schedule_message (source_message_id),
      INDEX idx_schedule_dedupe (user_id, dedupe_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (source_message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

async function createCandidatesForMessage({
  userId,
  sessionId,
  sourceMessageId,
  content,
  timezone = 'Asia/Shanghai',
  now = new Date(),
}) {
  const extracted = await extractScheduleCandidatesWithFallback({ content, timezone, now });
  if (extracted.length === 0) return [];

  const saved = [];
  for (const candidate of extracted) {
    const normalizedDedupeKey = candidate.dedupeKey;
    const [rows] = await db.execute(
      `SELECT id, status, title, start_time, date_text, location, participants_json, confidence, meta_json,
              created_at, updated_at, confirmed_at, dismissed_at
       FROM schedule_candidates
       WHERE user_id = ? AND dedupe_key = ? AND status IN ('candidate', 'confirmed')
       ORDER BY id DESC
       LIMIT 1`,
      [userId, normalizedDedupeKey]
    );

    if (rows[0]) {
      await db.execute(
        `UPDATE schedule_candidates
         SET confidence = GREATEST(confidence, ?),
             meta_json = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [candidate.confidence, JSON.stringify(candidate.meta || {}), rows[0].id]
      );

      saved.push(formatScheduleCandidateRow({
        ...rows[0],
        confidence: Math.max(Number(rows[0].confidence) || 0, candidate.confidence),
        meta_json: JSON.stringify(candidate.meta || {}),
      }));
      continue;
    }

    const [insertResult] = await db.execute(
      `INSERT INTO schedule_candidates (
         user_id, session_id, source_message_id, title, start_time, end_time, date_text, location,
         participants_json, confidence, status, dedupe_key, meta_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?)`,
      [
        userId,
        sessionId,
        sourceMessageId,
        candidate.title,
        candidate.startTime,
        candidate.endTime,
        candidate.dateText,
        candidate.location,
        JSON.stringify(candidate.participants || []),
        candidate.confidence,
        normalizedDedupeKey,
        JSON.stringify(candidate.meta || {}),
      ]
    );

    saved.push({
      id: insertResult.insertId,
      title: candidate.title,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      dateText: candidate.dateText,
      location: candidate.location,
      participants: candidate.participants,
      confidence: candidate.confidence,
      status: 'candidate',
      meta: candidate.meta || {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      confirmedAt: null,
      dismissedAt: null,
    });
  }

  return saved;
}

async function createCandidatesFromAssistantReply({
  userId,
  sessionId,
  sourceMessageId,
  content,
  timezone = 'Asia/Shanghai',
  now = new Date(),
}) {
  const extracted = extractAssistantPlanCandidates({ content, now }).filter((candidate) => candidate.startTime);
  if (extracted.length === 0) return [];

  const saved = [];
  for (const candidate of extracted) {
    const [rows] = await db.execute(
      `SELECT id, status, title, start_time, date_text, location, participants_json, confidence, meta_json,
              created_at, updated_at, confirmed_at, dismissed_at
       FROM schedule_candidates
       WHERE user_id = ? AND dedupe_key = ? AND status IN ('candidate', 'confirmed')
       ORDER BY id DESC
       LIMIT 1`,
      [userId, candidate.dedupeKey]
    );

    if (rows[0]) {
      await db.execute(
        `UPDATE schedule_candidates
         SET confidence = GREATEST(confidence, ?),
             meta_json = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [candidate.confidence, JSON.stringify(candidate.meta || {}), rows[0].id]
      );

      saved.push(formatScheduleCandidateRow({
        ...rows[0],
        confidence: Math.max(Number(rows[0].confidence) || 0, candidate.confidence),
        meta_json: JSON.stringify(candidate.meta || {}),
      }));
      continue;
    }

    const [insertResult] = await db.execute(
      `INSERT INTO schedule_candidates (
         user_id, session_id, source_message_id, title, start_time, end_time, date_text, location,
         participants_json, confidence, status, dedupe_key, meta_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?)`,
      [
        userId,
        sessionId,
        sourceMessageId,
        candidate.title,
        candidate.startTime,
        candidate.endTime,
        candidate.dateText,
        candidate.location,
        JSON.stringify(candidate.participants || []),
        candidate.confidence,
        candidate.dedupeKey,
        JSON.stringify(candidate.meta || {}),
      ]
    );

    saved.push({
      id: insertResult.insertId,
      title: candidate.title,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      dateText: candidate.dateText,
      location: candidate.location,
      participants: candidate.participants,
      confidence: candidate.confidence,
      status: 'candidate',
      meta: candidate.meta || {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      confirmedAt: null,
      dismissedAt: null,
    });
  }

  return saved;
}

async function extractCandidatesForTurn({
  content,
  previousUserContent = '',
  timezone = 'Asia/Shanghai',
  now = new Date(),
}) {
  const direct = await extractScheduleCandidatesWithFallback({ content, timezone, now });
  if (direct.length > 0) {
    return { candidates: direct, source: 'direct', combinedContent: content };
  }

  const normalizedPrevious = normalizeText(previousUserContent);
  const normalizedCurrent = normalizeText(content);
  if (!shouldAttemptContextualCompletion(normalizedCurrent, normalizedPrevious)) {
    return { candidates: [], source: 'none', combinedContent: content };
  }

  const contextual = await extractContextualScheduleCandidates({
    previousUserContent: normalizedPrevious,
    currentUserContent: normalizedCurrent,
    timezone,
    now,
  });
  if (contextual.length > 0) {
    return {
      candidates: contextual,
      source: 'contextual',
      combinedContent: mergeScheduleContextText(normalizedPrevious, normalizedCurrent),
    };
  }

  return { candidates: [], source: 'none', combinedContent: content };
}

async function listCandidatesForUser({ userId, status = 'candidate', limit = 20 }) {
  const normalizedLimit = clampPositiveInt(limit, 20);
  const params = [userId];
  let where = 'WHERE user_id = ?';

  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }

  const [rows] = await db.execute(
    `SELECT id, source_message_id, title, start_time, end_time, date_text, location, participants_json,
            confidence, status, meta_json, created_at, updated_at, confirmed_at, dismissed_at
     FROM schedule_candidates
     ${where}
     ORDER BY COALESCE(start_time, created_at) ASC, id DESC
     LIMIT ${normalizedLimit}`,
    params
  );

  return rows.map(formatScheduleCandidateRow);
}

async function listCandidatesForMessages({ userId, messageIds = [] }) {
  const normalizedIds = [...new Set((Array.isArray(messageIds) ? messageIds : []).filter(Boolean))];
  if (normalizedIds.length === 0) return new Map();

  const placeholders = normalizedIds.map(() => '?').join(', ');
  const [rows] = await db.execute(
    `SELECT id, source_message_id, title, start_time, end_time, date_text, location, participants_json,
            confidence, status, meta_json, created_at, updated_at, confirmed_at, dismissed_at
     FROM schedule_candidates
     WHERE user_id = ? AND source_message_id IN (${placeholders}) AND status IN ('candidate', 'confirmed', 'edited')
     ORDER BY created_at ASC, id ASC`,
    [userId, ...normalizedIds]
  );

  const grouped = new Map();
  rows.forEach((row) => {
    const key = Number(row.source_message_id);
    const list = grouped.get(key) || [];
    list.push(formatScheduleCandidateRow(row));
    grouped.set(key, list);
  });
  return grouped;
}

async function confirmCandidate({ userId, candidateId }) {
  await db.execute(
    `UPDATE schedule_candidates
     SET status = 'confirmed', confirmed_at = NOW(), dismissed_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND id = ?`,
    [userId, candidateId]
  );
  return getCandidateById({ userId, candidateId });
}

async function dismissCandidate({ userId, candidateId }) {
  await db.execute(
    `UPDATE schedule_candidates
     SET status = 'dismissed', dismissed_at = NOW(), updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND id = ?`,
    [userId, candidateId]
  );
  return getCandidateById({ userId, candidateId });
}

async function getCandidateById({ userId, candidateId }) {
  const [rows] = await db.execute(
    `SELECT id, source_message_id, title, start_time, end_time, date_text, location, participants_json,
            confidence, status, meta_json, created_at, updated_at, confirmed_at, dismissed_at
     FROM schedule_candidates
     WHERE user_id = ? AND id = ?
     LIMIT 1`,
    [userId, candidateId]
  );
  return rows[0] ? formatScheduleCandidateRow(rows[0]) : null;
}

async function updateCandidate({
  userId,
  candidateId,
  title,
  dateText,
  location = '',
  notes = '',
}) {
  const existing = await getCandidateById({ userId, candidateId });
  if (!existing) return null;

  const nextTitle = cleanupText(title);
  const nextDateText = cleanupText(dateText);
  if (!nextTitle || !nextDateText) {
    const error = new Error('title and dateText are required');
    error.statusCode = 400;
    throw error;
  }

  const temporal = parseTemporalText(nextDateText, new Date());
  if (looksLikeInvalidTemporalEdit(nextDateText, temporal)) {
    const error = new Error('Please enter a valid date/time, for example “今天下午2点” or “3月30日下午2点”');
    error.statusCode = 400;
    throw error;
  }
  if (!temporal.dateMatch && !temporal.startTime) {
    const error = new Error('Please enter a clearer date/time, for example “今天下午2点”');
    error.statusCode = 400;
    throw error;
  }
  const nextLocation = cleanupText(location).slice(0, 160);
  const nextNotes = cleanupText(notes).slice(0, 280);
  const nextParticipants = Array.isArray(existing.participants) ? existing.participants : [];
  const nextStatus = existing.status === 'confirmed' ? 'confirmed' : 'candidate';
  const normalizedDateText = temporal.dateMatch
    ? buildDisplayDateText(temporal.dateMatch, temporal.timeMatch)
    : nextDateText;
  const nextDedupeKey = buildDedupeKey({
    title: nextTitle,
    dateText: normalizedDateText,
    startTime: temporal.startTime,
    location: nextLocation,
  });

  await db.execute(
    `UPDATE schedule_candidates
     SET title = ?,
         start_time = ?,
         end_time = ?,
         date_text = ?,
         location = ?,
         participants_json = ?,
         status = ?,
         dedupe_key = ?,
         meta_json = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND id = ?`,
    [
      nextTitle,
      temporal.startTime,
      temporal.endTime,
      normalizedDateText,
      nextLocation || null,
      JSON.stringify(nextParticipants),
      nextStatus,
      nextDedupeKey,
      JSON.stringify({
        ...(existing.meta || {}),
        editedByUser: true,
        needsConfirmation: !temporal.startTime,
        parsedDate: temporal.startTime ? temporal.startTime.slice(0, 10) : null,
        notes: nextNotes || undefined,
      }),
      userId,
      candidateId,
    ]
  );

  return getCandidateById({ userId, candidateId });
}

async function extractScheduleCandidatesWithFallback({ content, timezone = 'Asia/Shanghai', now = new Date() }) {
  const llmResult = await extractScheduleCandidatesWithLLM({ content, timezone, now });
  if (llmResult.status === 'success') return llmResult.candidates;
  if (llmResult.status === 'no_candidate' || llmResult.status === 'skipped') return [];
  return extractScheduleCandidates({ content, timezone, now });
}

async function extractContextualScheduleCandidates({
  previousUserContent,
  currentUserContent,
  timezone = 'Asia/Shanghai',
  now = new Date(),
}) {
  const llmResult = await extractContextualScheduleCandidatesWithLLM({
    previousUserContent,
    currentUserContent,
    timezone,
    now,
  });
  if (llmResult.status === 'success') return llmResult.candidates;
  if (llmResult.status === 'no_candidate' || llmResult.status === 'skipped') return [];
  return extractScheduleCandidates({
    content: mergeScheduleContextText(previousUserContent, currentUserContent),
    timezone,
    now,
  });
}

function extractScheduleCandidates({ content, timezone = 'Asia/Shanghai', now = new Date() }) {
  const normalized = normalizeText(content);
  if (!normalized) return [];
  if (PAST_PATTERNS.some((pattern) => pattern.test(normalized))) return [];

  const clauses = splitClauses(normalized);
  const candidates = [];
  const seen = new Set();
  let inheritedDateMatch = null;

  for (const clause of clauses) {
    if (!looksLikeScheduleClause(clause)) continue;
    const parsed = parseScheduleClause(clause, { timezone, now, inheritedDateMatch });
    if (!parsed) continue;
    inheritedDateMatch = parsed._dateMatch || inheritedDateMatch;
    if (seen.has(parsed.dedupeKey)) continue;
    seen.add(parsed.dedupeKey);
    candidates.push(parsed);
  }

  return candidates.slice(0, 3);
}

function extractAssistantPlanCandidates({ content, now = new Date() }) {
  const normalized = normalizeText(content);
  if (!normalized) return [];
  if (!/(今天|明天|后天|大后天|比赛当天|早晨|早上|上午|午餐后|中午|下午|晚上|睡前|今晚|夜里|比赛前)/.test(normalized)) return [];
  if (!/(训练|练习|散步|冥想|深呼吸|呼吸|伸展|写下|阅读|看电影|放松|恢复|康复|调整)/.test(normalized)) return [];

  const lines = String(content || '')
    .split(/\n+/)
    .map((line) => normalizeAssistantPlanLine(line))
    .filter(Boolean);

  const candidates = [];
  const seen = new Set();
  let activePeriod = '';
  let activeDayContext = { label: '今天', date: stripTime(now instanceof Date ? now : new Date(now)) };
  const today = stripTime(now instanceof Date ? now : new Date(now));

  for (const line of lines) {
    const dayContext = parseAssistantDayContext(line, today);
    if (dayContext) {
      activeDayContext = dayContext;
      const inlineAfterDay = cleanupText(line.replace(/^(今天|明天|后天|大后天|比赛当天|比赛前一天|\d{1,2}月\d{1,2}日(?:（[^）]+）)?)(?:\s*[:：])?\s*/, ''));
      if (!inlineAfterDay) continue;
      const inlinePeriod = inlineAfterDay.match(ASSISTANT_PERIOD_PATTERN);
      if (!inlinePeriod) continue;
      activePeriod = inlinePeriod[1];
      const inlineContent = cleanupText(inlineAfterDay.replace(/^(早晨|早上|上午|午餐后|中午|下午|晚上|睡前|今晚|夜里|比赛前|演讲前)\s*[:：]?\s*/, ''));
      if (inlineContent) {
        pushAssistantPlanCandidate({
          bucket: candidates,
          seen,
          text: inlineContent,
          period: activePeriod,
          dayContext: activeDayContext,
        });
      }
      continue;
    }

    const periodMatch = line.match(ASSISTANT_PERIOD_PATTERN);
    if (periodMatch) {
      activePeriod = periodMatch[1];
      if (!/[:：]$/.test(line) && !/^\d+\./.test(line)) {
        const inlineContent = cleanupText(line.replace(/^(早晨|早上|上午|午餐后|中午|下午|晚上|睡前|今晚|夜里|比赛前|演讲前)\s*[:：]?\s*/, ''));
        if (inlineContent) {
          pushAssistantPlanCandidate({
            bucket: candidates,
            seen,
            text: inlineContent,
            period: activePeriod,
            dayContext: activeDayContext,
          });
        }
      }
      continue;
    }

    if (!activePeriod) continue;
    pushAssistantPlanCandidate({
      bucket: candidates,
      seen,
      text: line,
      period: activePeriod,
      dayContext: activeDayContext,
    });
  }

  return candidates.slice(0, 12);
}

function pushAssistantPlanCandidate({ bucket, seen, text, period, dayContext }) {
  const originalText = cleanupText(text);
  const temporalInput = stripDurationRanges(`${period} ${originalText}`);
  const cleaned = cleanupText(text)
    .replace(/^(轻松的|短暂的|一些|进行一些|进行|做一些|试试|可以|建议你)\s*/g, '')
    .replace(/，?持续\d+\s*[-–~到至]\s*\d+\s*分钟/g, '')
    .replace(/，?持续\d+\s*分钟/g, '')
    .replace(/，?关注[^。；;，,]+/g, '')
    .replace(/，?帮助你[^。；;，,]+/g, '')
    .replace(/，?放松心情/g, '')
    .replace(/。+$/g, '')
    .trim();

  if (!cleaned || cleaned.length < 2) return;
  if (isAssistantPracticeNoise(cleaned)) return;

  const title = cleaned.length > 28 ? cleaned.slice(0, 28).trim() : cleaned;
  const temporal = parseTemporalText(temporalInput, dayContext?.date || new Date());
  const timeMatch = temporal.timeMatch || { text: period, exact: false };
  const fallbackDateText = buildAssistantDateText(dayContext, timeMatch);
  const dateText = temporal.dateMatch
    ? buildDisplayDateText(temporal.dateMatch, timeMatch)
    : fallbackDateText;
  const dedupeKey = buildDedupeKey({ title, dateText, startTime: temporal.startTime, location: '' });
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);

  bucket.push({
    title,
    startTime: temporal.startTime,
    endTime: temporal.endTime,
    dateText,
    location: '',
    participants: [],
    confidence: temporal.startTime ? 0.82 : 0.76,
    dedupeKey,
    meta: {
      source: 'assistant_plan_v1',
      period,
      dayLabel: dayContext?.label || '今天',
      parsedDate: temporal.startTime
        ? temporal.startTime.slice(0, 10)
        : dayContext?.date
          ? formatDateKey(dayContext.date)
          : null,
      needsConfirmation: !temporal.startTime,
      planType: 'wellbeing_routine',
    },
  });
}

function parseAssistantDayContext(text, today) {
  const normalized = normalizeText(text);
  const absoluteDate = normalized.match(/(\d{1,2})月(\d{1,2})日/);
  const relative = normalized.match(/(今天|明天|后天|大后天|比赛当天|比赛前一天)/);

  if (absoluteDate) {
    let year = today.getFullYear();
    const month = Number(absoluteDate[1]);
    const day = Number(absoluteDate[2]);
    let date = new Date(year, month - 1, day);
    if (date < stripTime(today)) {
      year += 1;
      date = new Date(year, month - 1, day);
    }
    const label = relative?.[1] || absoluteDate[0];
    return { label, date };
  }

  if (!relative) return null;
  const label = relative[1];
  if (label === '明天') return { label, date: addDays(today, 1) };
  if (label === '后天') return { label, date: addDays(today, 2) };
  if (label === '大后天') return { label, date: addDays(today, 3) };
  if (label === '比赛前一天') return { label, date: addDays(today, 1) };
  if (label === '比赛当天') return { label, date: null };
  return { label: '今天', date: today };
}

function buildAssistantDateText(dayContext, timeMatch) {
  const label = dayContext?.label || '今天';
  if (dayContext?.date) {
    return buildDisplayDateText({ text: label, date: dayContext.date, exact: label !== '比赛当天' }, timeMatch);
  }
  return [label, timeMatch?.text].filter(Boolean).join(' ').trim();
}

async function extractScheduleCandidatesWithLLM({ content, timezone = 'Asia/Shanghai', now = new Date() }) {
  const normalized = normalizeText(content);
  if (!normalized) return { status: 'skipped', candidates: [] };
  if (!shouldAttemptScheduleExtraction(normalized)) return { status: 'skipped', candidates: [] };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: 'unavailable', candidates: [] };

  const endpoint = `${OPENAI_BASE_URL}/chat/completions`;
  const nowDate = now instanceof Date ? now : new Date(now);
  const prompt = [
    '你是一个日程候选判定器兼结构化抽取器。你的任务是先判断用户原话是否值得生成日程候选，再做结构化提取。',
    '只返回 JSON，不要返回解释。',
    '输出格式：{"shouldCreate":true,"decisionConfidence":0.0,"reason":"","candidates":[{"title":"","dateText":"","timeText":"","location":"","participants":[],"confidence":0.0,"isSchedule":true}]}',
    '规则：',
    '- 先判断这句话是否像“应该在 UI 里展示的未来安排候选”。',
    '- 只提取明确的未来安排，不提取回忆、假设、愿望、情绪表达、泛泛打算、模糊想法。',
    '- 仅仅因为出现“今天/明天/下周”和一个动作，不足以创建候选。',
    '- 如果只是笼统意向，例如“我今天要打球”“我这周想找时间运动”“明天可能去一下”，默认 shouldCreate=false。',
    '- 如果已经像一个具体安排、承诺、约定或明确时间块，例如有明确对象/地点/时间段/特定事务（如复诊、面试、开会），才更适合 shouldCreate=true。',
    '- 如果用户明确说“帮我加入日程/加到日程里/设提醒”，并且句子里已经有具体事件与具体时间（如“上午10去咖啡馆喝咖啡”），即使没写“今天”，也优先按同一天理解并 shouldCreate=true。',
    '- title 必须是事件本身，例如“喝咖啡”“打球”“和老板聊离职”。不要把地点放进 title。',
    '- location 只放地点，例如“咖啡馆”“体育馆”“公司会议室”。',
    '- participants 只放人物，不放地点。',
    '- dateText 只放日期相关表达，例如“今天”“明天”“下周五”“3月20日”。',
    '- timeText 只放时间相关表达，例如“早上8-9”“下午3点”“晚上”。',
    '- 如果时间不明确，可以留空，但 dateText 尽量保留。',
    '- 最多返回 3 个 candidate。',
    '- 对不确定内容降低 confidence，不要乱编。',
    '',
    `当前日期: ${formatMonthDay(nowDate)} (${formatDateKey(stripTime(nowDate))})`,
    `时区: ${timezone}`,
    `用户原话: ${normalized}`,
  ].join('\n');

  try {
    const response = await axios.post(
      endpoint,
      {
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: '你只返回严格 JSON。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 280,
        response_format: { type: 'json_object' },
      },
      {
        timeout: SCHEDULE_EXTRACTION_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        ...buildProxyConfig(endpoint),
      }
    );

    const raw = response.data?.choices?.[0]?.message?.content || '{}';
    const parsed = safeParse(raw, {});
    const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    const normalizedCandidates = candidates
      .map((candidate) => normalizeLLMScheduleCandidate(candidate, normalized, nowDate))
      .filter(Boolean)
      .slice(0, 3);
    const shouldCreate = parsed.shouldCreate !== false && normalizedCandidates.length > 0;

    if (!shouldCreate) {
      return {
        status: 'no_candidate',
        candidates: [],
      };
    }

    return {
      status: normalizedCandidates.length > 0 ? 'success' : 'no_candidate',
      candidates: normalizedCandidates,
    };
  } catch {
    return { status: 'error', candidates: [] };
  }
}

async function extractContextualScheduleCandidatesWithLLM({
  previousUserContent,
  currentUserContent,
  timezone = 'Asia/Shanghai',
  now = new Date(),
}) {
  if (!previousUserContent || !currentUserContent) {
    return { status: 'skipped', candidates: [] };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: 'unavailable', candidates: [] };

  const endpoint = `${OPENAI_BASE_URL}/chat/completions`;
  const nowDate = now instanceof Date ? now : new Date(now);
  const mergedContext = mergeScheduleContextText(previousUserContent, currentUserContent);
  const prompt = [
    '你是一个多轮日程补全器。',
    '任务：判断“用户当前这句”是否是在补充上一句里的时间/地点/事件，从而共同构成一个应该展示在 UI 里的未来安排候选。',
    '你的职责是直接输出结构化语义，不要靠原句照抄。',
    '只返回 JSON，不要返回解释。',
    '输出格式：{"shouldCreate":true,"candidate":{"title":"","dateText":"","timeText":"","location":"","participants":[],"confidence":0.0,"mergeReason":""}}',
    '规则：',
    '- 只有当当前句明显是在补充上一句的日程信息时，才 shouldCreate=true。',
    '- 如果上一句已经有时间/地点/安排框架，当前句只是补充事件名称、参与人、加入日程请求，应该把两句合并理解。',
    '- 不要编造不存在的其他计划。',
    '- title 必须只写事件本身，例如“打羽毛球”“喝咖啡”“和老板聊离职”。不要把地点写进 title。',
    '- location 只写地点，例如“体育馆”“咖啡馆”“公司会议室”。',
    '- dateText 只写日期表达，例如“今天”“明天”“3月30日”。',
    '- timeText 只写时间表达，例如“下午3点”“上午10点”“晚上7-8点”。',
    '- 如果当前轮只是把“打球”补充成“打羽毛球”，应该输出 title="打羽毛球"，而不是“去体育馆打羽毛球”。',
    '- participants 只写人物，不写地点。',
    '',
    `当前日期: ${formatMonthDay(nowDate)} (${formatDateKey(stripTime(nowDate))})`,
    `时区: ${timezone}`,
    `上一句用户消息: ${previousUserContent}`,
    `当前用户消息: ${currentUserContent}`,
    `合并理解后的语义参考: ${mergedContext}`,
  ].join('\n');

  try {
    const response = await axios.post(
      endpoint,
      {
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: '你只返回严格 JSON。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 280,
        response_format: { type: 'json_object' },
      },
      {
        timeout: SCHEDULE_EXTRACTION_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        ...buildProxyConfig(endpoint),
      }
    );

    const raw = response.data?.choices?.[0]?.message?.content || '{}';
    const parsed = safeParse(raw, {});
    const normalizedCandidate = normalizeStructuredScheduleCandidate(parsed.candidate, {
      originalContent: mergedContext,
      now: nowDate,
      source: 'chat_schedule_context_llm_v1',
    });
    const normalizedCandidates = normalizedCandidate ? [normalizedCandidate] : [];
    const shouldCreate = parsed.shouldCreate !== false && normalizedCandidates.length > 0;

    if (!shouldCreate) {
      return { status: 'no_candidate', candidates: [] };
    }

    return {
      status: normalizedCandidates.length > 0 ? 'success' : 'no_candidate',
      candidates: normalizedCandidates,
    };
  } catch {
    return { status: 'error', candidates: [] };
  }
}

function normalizeLLMScheduleCandidate(candidate, originalContent, now) {
  return normalizeStructuredScheduleCandidate(candidate, {
    originalContent,
    now,
    source: 'chat_schedule_llm_v1',
  });
}

function normalizeStructuredScheduleCandidate(candidate, {
  originalContent,
  now,
  source,
}) {
  if (!candidate || candidate.isSchedule === false) return null;

  const title = cleanupText(candidate.title);
  const location = cleanupText(candidate.location).slice(0, 40);
  const participants = normalizeParticipants(candidate.participants);
  const dateText = cleanupText(candidate.dateText);
  const timeText = cleanupText(candidate.timeText);
  const combinedTemporalText = [dateText, timeText].filter(Boolean).join(' ').trim();
  const temporal = combinedTemporalText ? parseTemporalText(combinedTemporalText, now) : { startTime: null, endTime: null, dateMatch: null, timeMatch: null };

  if (!title || title.length < 2) return null;
  if (!dateText && !temporal.startTime) return null;
  if (HYPOTHETICAL_PATTERNS.some((pattern) => pattern.test(title)) || PAST_PATTERNS.some((pattern) => pattern.test(title))) return null;

  const displayDateText = temporal.dateMatch
    ? buildDisplayDateText(temporal.dateMatch, temporal.timeMatch)
    : combinedTemporalText;
  const confidence = normalizeConfidence(candidate.confidence, { temporal, location, participants });
  const dedupeKey = buildDedupeKey({
    title,
    dateText: displayDateText,
    startTime: temporal.startTime,
    location,
  });

  return {
    title,
    startTime: temporal.startTime,
    endTime: temporal.endTime,
    dateText: displayDateText,
    location,
    participants,
    confidence,
    dedupeKey,
    _dateMatch: temporal.dateMatch,
    meta: {
      source,
      clause: originalContent,
      needsConfirmation: !temporal.startTime,
      parsedDate: temporal.startTime ? temporal.startTime.slice(0, 10) : null,
      inheritedDateSource: null,
      dateInfo: temporal.dateMatch
        ? {
            text: temporal.dateMatch.text,
            date: formatLocalDateTime(temporal.dateMatch.date),
          }
        : {
            text: dateText,
            date: null,
          },
    },
  };
}

function parseScheduleClause(clause, { now, inheritedDateMatch = null }) {
  if (!hasEventSignal(clause)) return null;
  if (HYPOTHETICAL_PATTERNS.some((pattern) => pattern.test(clause))) return null;

  const ownDateMatch = parseDateInfo(clause, now);
  const dateMatch = ownDateMatch || inheritedDateMatch;
  if (!dateMatch) return null;

  const timeMatch = parseTimeInfo(clause);
  const location = extractLocation(clause);
  const participants = extractParticipants(clause);
  const title = extractTitle(clause, { dateMatch: ownDateMatch || dateMatch, timeMatch, location });
  if (!title || title.length < 2) return null;

  const startTime = buildStartTime(dateMatch.date, timeMatch);
  const endTime = buildEndTime(dateMatch.date, timeMatch);
  const confidence = computeConfidence({ dateMatch, timeMatch, location, participants, clause });
  const dateText = buildDisplayDateText(dateMatch, timeMatch);
  const dedupeKey = buildDedupeKey({ title, dateText, startTime, location });

  return {
    title,
    startTime,
    endTime,
    dateText,
    location,
    participants,
    confidence,
    dedupeKey,
    _dateMatch: dateMatch,
    meta: {
      source: 'chat_schedule_v1',
      clause,
      needsConfirmation: !startTime,
      parsedDate: startTime ? startTime.slice(0, 10) : null,
      inheritedDateSource: ownDateMatch ? null : dateMatch.text,
      dateInfo: {
        text: dateMatch.text,
        date: formatLocalDateTime(dateMatch.date),
      },
    },
  };
}

function parseTemporalText(dateText, now = new Date()) {
  const normalized = normalizeText(dateText);
  const dateMatch = parseDateInfo(normalized, now);
  const timeMatch = parseTimeInfo(normalized);
  return {
    startTime: dateMatch ? buildStartTime(dateMatch.date, timeMatch) : null,
    endTime: dateMatch ? buildEndTime(dateMatch.date, timeMatch) : null,
    dateMatch,
    timeMatch,
  };
}

function looksLikeScheduleClause(clause) {
  return hasStrongScheduleSignal(clause) && !HYPOTHETICAL_PATTERNS.some((pattern) => pattern.test(clause));
}

function hasFutureSignal(text) {
  return FUTURE_TIME_PATTERNS.some((pattern) => pattern.test(text));
}

function shouldAttemptScheduleExtraction(text) {
  return hasFutureSignal(text) || hasStrongScheduleSignal(text) || hasExplicitScheduleRequest(text);
}

function hasEventSignal(text) {
  return EVENT_TERMS.some((term) => text.includes(term));
}

function hasParticipantSignal(text) {
  return PARTICIPANT_TERMS.some((term) => text.includes(term));
}

function hasStrongScheduleSignal(text) {
  if (!hasEventSignal(text)) return false;
  const hasFuture = hasFutureSignal(text);
  const hasConcreteTime = Boolean(parseTimeInfo(text)?.text);
  const hasLocation = /(在|到|去)[^，。；,;]{1,20}/.test(text);
  const hasParticipant = hasParticipantSignal(text);
  const hasStructuredEvent = /(复诊|复查|看牙|看医生|面试|上课|汇报|开会|meeting|interview|appointment)/i.test(text);
  const hasTimeRange = hasConcreteClockTime(text);
  const hasCommitmentVerb = /(约了|约好|安排了|定了|得去|要去|要和|要跟|得和|得跟|要见|要聊|要沟通|要复诊|要面试|要开会)/.test(text);

  if (!hasFuture && !hasTimeRange) return false;
  return hasStructuredEvent || hasConcreteTime || hasLocation || hasParticipant || hasCommitmentVerb;
}

function parseDateInfo(text, now) {
  const today = new Date(now);
  if (/大后天/.test(text)) {
    return { text: '大后天', date: addDays(today, 3), exact: true };
  }
  if (/后天/.test(text)) {
    return { text: '后天', date: addDays(today, 2), exact: true };
  }
  if (/明天|明早|明晚/.test(text)) {
    return { text: text.match(/明天|明早|明晚/)?.[0] || '明天', date: addDays(today, 1), exact: true };
  }
  if (/今天|今晚|今早|今晨/.test(text)) {
    return { text: text.match(/今天|今晚|今早|今晨/)?.[0] || '今天', date: today, exact: true };
  }

  const nextWeekdayMatch = text.match(/下周([一二三四五六日天])/);
  if (nextWeekdayMatch) {
    return {
      text: nextWeekdayMatch[0],
      date: nextWeekday(today, nextWeekdayMatch[1], true),
      exact: true,
    };
  }

  const weekdayMatch = text.match(/(?:周|星期|礼拜)([一二三四五六日天])/);
  if (weekdayMatch) {
    return {
      text: weekdayMatch[0],
      date: nextWeekday(today, weekdayMatch[1], false),
      exact: true,
    };
  }

  const fullDateMatch = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (fullDateMatch) {
    const month = Number(fullDateMatch[1]);
    const day = Number(fullDateMatch[2]);
    if (!isValidMonthDay(today.getFullYear(), month, day)) return null;
    let year = today.getFullYear();
    let date = new Date(year, month - 1, day);
    if (date < stripTime(today)) {
      year += 1;
      if (!isValidMonthDay(year, month, day)) return null;
      date = new Date(year, month - 1, day);
    }
    return { text: fullDateMatch[0], date, exact: true };
  }

  const shortDateMatch = text.match(/(\d{1,2})[\/.-](\d{1,2})/);
  if (shortDateMatch) {
    const month = Number(shortDateMatch[1]);
    const day = Number(shortDateMatch[2]);
    if (!isValidMonthDay(today.getFullYear(), month, day)) return null;
    let year = today.getFullYear();
    let date = new Date(year, month - 1, day);
    if (date < stripTime(today)) {
      year += 1;
      if (!isValidMonthDay(year, month, day)) return null;
      date = new Date(year, month - 1, day);
    }
    return { text: shortDateMatch[0], date, exact: true };
  }

  if (shouldInferSameDayDate(text)) {
    return { text: '今天', date: today, exact: false, inferred: true };
  }

  return null;
}

function parseTimeInfo(text) {
  const rangeMatch = text.match(/(上午|中午|下午|晚上|今晚|早上|凌晨|傍晚)?\s*([零〇一二两三四五六七八九十\d]{1,3})\s*[-~到至－—]\s*([零〇一二两三四五六七八九十\d]{1,3})\s*(点|点钟|h|H|:00)?/);
  if (rangeMatch) {
    const meridiem = rangeMatch[1] || '';
    const rawStartHour = parseChineseNumber(rangeMatch[2]);
    const rawEndHour = parseChineseNumber(rangeMatch[3]);
    if (Number.isFinite(rawStartHour) && Number.isFinite(rawEndHour)) {
      return {
        text: rangeMatch[0].trim(),
        hour: normalizeHour(rawStartHour, meridiem),
        minute: 0,
        endHour: normalizeHour(rawEndHour, meridiem),
        endMinute: 0,
        exact: true,
      };
    }
  }

  const colonMatch = text.match(/(上午|中午|下午|晚上|今晚|早上|凌晨|傍晚)?\s*(\d{1,2})[:：](\d{2})/);
  if (colonMatch) {
    const meridiem = colonMatch[1] || '';
    const hour = normalizeHour(Number(colonMatch[2]), meridiem);
    const minute = Number(colonMatch[3]);
    return {
      text: colonMatch[0].trim(),
      hour,
      minute,
      endHour: null,
      endMinute: null,
      exact: true,
    };
  }

  const pointMatch = text.match(/(上午|中午|下午|晚上|今晚|早上|凌晨|傍晚)?\s*([零〇一二两三四五六七八九十\d]{1,3})点(?:(半|一刻|三刻)|([零〇一二两三四五六七八九十\d]{1,3})分?)?/);
  if (pointMatch) {
    const meridiem = pointMatch[1] || '';
    const rawHour = parseChineseNumber(pointMatch[2]);
    if (!Number.isFinite(rawHour)) return null;
    let minute = 0;
    if (pointMatch[3] === '半') minute = 30;
    if (pointMatch[3] === '一刻') minute = 15;
    if (pointMatch[3] === '三刻') minute = 45;
    if (pointMatch[4]) minute = parseChineseNumber(pointMatch[4]);
    return {
      text: pointMatch[0].trim(),
      hour: normalizeHour(rawHour, meridiem),
      minute,
      endHour: null,
      endMinute: null,
      exact: true,
    };
  }

  const meridiemHourMatch = text.match(/(上午|中午|下午|晚上|今晚|早上|凌晨|傍晚)\s*([零〇一二两三四五六七八九十\d]{1,3})(?=\s*(?:[.．。,:：，,、]|$|要|去|在|和|跟|见|聊|喝|吃|打|跑|复|开|面|上|准备))/);
  if (meridiemHourMatch) {
    const meridiem = meridiemHourMatch[1] || '';
    const rawHour = parseChineseNumber(meridiemHourMatch[2]);
    if (!Number.isFinite(rawHour)) return null;
    return {
      text: meridiemHourMatch[0].trim(),
      hour: normalizeHour(rawHour, meridiem),
      minute: 0,
      endHour: null,
      endMinute: null,
      exact: true,
    };
  }

  const roughMatch = text.match(/(上午|中午|下午|晚上|今晚|早上|凌晨|傍晚)/);
  if (roughMatch) {
    return {
      text: roughMatch[0],
      hour: null,
      minute: null,
      endHour: null,
      endMinute: null,
      exact: false,
    };
  }

  return null;
}

function hasConcreteClockTime(text) {
  return /\d{1,2}\s*[-~到至－—]\s*\d{1,2}|\d{1,2}[:：]\d{2}|\d{1,2}点|(上午|中午|下午|晚上|今晚|早上|凌晨|傍晚)\s*[零〇一二两三四五六七八九十\d]{1,3}/.test(text);
}

function shouldAttemptContextualCompletion(currentText, previousText) {
  if (!currentText || !previousText) return false;
  if (PAST_PATTERNS.some((pattern) => pattern.test(currentText))) return false;
  if (!hasStrongScheduleSignal(previousText) && !hasFutureSignal(previousText)) return false;
  if (hasStrongScheduleSignal(currentText) || hasFutureSignal(currentText)) return false;

  const stripped = stripScheduleRequestLanguage(currentText);
  if (!stripped) return false;
  if (stripped.length <= 12) return true;
  return hasExplicitScheduleRequest(currentText) && stripped.length <= 20;
}

function mergeScheduleContextText(previousText, currentText) {
  const previous = normalizeText(previousText);
  const strippedCurrent = stripScheduleRequestLanguage(currentText);
  if (!previous) return normalizeText(currentText);
  if (!strippedCurrent) return previous;

  const sport = extractSportName(strippedCurrent);
  if (sport && /打球/.test(previous)) {
    return previous.replace(/打球/, `打${sport}`);
  }

  if (previous.includes(strippedCurrent)) return previous;
  return `${previous}，补充：${strippedCurrent}`;
}

function stripScheduleRequestLanguage(text) {
  return normalizeText(text)
    .replace(/(?:帮我|帮忙|请|麻烦)\s*/g, ' ')
    .replace(/(?:把|将)\s*/g, ' ')
    .replace(/(?:加入|加到|添加到|放进|记到|安排到)\s*(?:日程|行程|计划|calendar)/gi, ' ')
    .replace(/设(?:一个)?提醒/g, ' ')
    .replace(/^(这个|那个|就是|是|对，是|对,?是)\s*/, '')
    .replace(/[，,。.!！?？；;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSportName(text) {
  const normalized = normalizeText(text);
  return SPORT_TERMS.find((item) => normalized.includes(item)) || '';
}

function looksLikeInvalidTemporalEdit(text, temporal) {
  const normalized = normalizeText(text);
  if (temporal.dateMatch) return false;
  if (/\d{1,2}月\d{1,3}日/.test(normalized)) return true;
  if (/\d{1,2}[\/.-]\d{1,3}/.test(normalized)) return true;
  if (/(今天|明天|后天|大后天|下周[一二三四五六日天]?|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天])/.test(normalized)) {
    return true;
  }
  return false;
}

function isValidMonthDay(year, month, day) {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(year, month - 1, day);
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
}

function hasExplicitScheduleRequest(text) {
  return EXPLICIT_SCHEDULE_REQUEST_PATTERN.test(text);
}

function shouldInferSameDayDate(text) {
  if (hasFutureSignal(text)) return false;
  if (PAST_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (HYPOTHETICAL_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (!hasEventSignal(text)) return false;

  const timeInfo = parseTimeInfo(text);
  if (!timeInfo?.exact) return false;

  const hasSameDayPeriodCue = /(上午|中午|下午|晚上|今晚|早上|凌晨|傍晚)/.test(text);
  return hasSameDayPeriodCue || hasExplicitScheduleRequest(text);
}

function extractLocation(text) {
  const match = text.match(/(?:在|到|去)([^，。；,;]{1,24}?)(?=和|跟|找|见|聊|沟通|开会|复诊|复查|看牙|看医生|面试|上课|吃饭|喝咖啡|提交|汇报|讨论|参加|打(?:球|羽毛球|篮球|网球|乒乓球|排球|足球)|羽毛球|篮球|网球|乒乓球|排球|足球|跑步|游泳|爬山|健身|训练|运动|散步|逛街|买东西|看电影|$)/);
  if (!match) return '';
  const location = cleanupText(match[1])
    .replace(/^(一下|一趟)/, '')
    .slice(0, 40);
  if (!location) return '';
  if (EVENT_TERMS.some((term) => location === term || location.startsWith(term))) return '';
  return location;
}

function extractParticipants(text) {
  const participants = PARTICIPANT_TERMS.filter((term) => text.includes(term));
  return [...new Set(participants)].slice(0, 4);
}

function normalizeParticipants(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => cleanupText(item)).filter(Boolean))].slice(0, 6);
  }
  if (typeof value === 'string') {
    return [...new Set(
      value
        .split(/[,，、/]/)
        .map((item) => cleanupText(item))
        .filter(Boolean)
    )].slice(0, 6);
  }
  return [];
}

function extractTitle(text, { dateMatch, timeMatch, location }) {
  let title = text;
  if (dateMatch?.text) title = title.replace(dateMatch.text, ' ');
  if (timeMatch?.text) title = title.replace(timeMatch.text, ' ');
  title = title
    .replace(/^我\s*/, '')
    .replace(/^(我要|我得|我会|我想|我准备|我打算|得|要|准备|打算)\s*/, '')
    .replace(/\b(一下|一趟)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (location) {
    title = title
      .replace(new RegExp(`^(?:准备|打算)?\\s*(?:在|到|去)?\\s*${escapeRegExp(location)}`), '')
      .trim();
  }
  title = title.replace(/^(准备|打算)\s*/, '').trim();
  title = title.replace(/^(然后|接着|之后)\s*/, '').trim();
  title = title.replace(/^要\s*/, '').trim();
  if (location) {
    title = title
      .replace(new RegExp(`^(?:在|到|去)\\s*${escapeRegExp(location)}`), '')
      .trim();
  }
  title = title.replace(/^[-~到至－—:：.．、，,\s]+/, '').trim();
  title = title.replace(/[。！!？?；;，,]+$/g, '').trim();

  if (title.length > 36) {
    title = title.slice(0, 36).trim();
  }

  return title;
}

function computeConfidence({ dateMatch, timeMatch, location, participants, clause }) {
  let confidence = 0.58;
  if (dateMatch?.exact) confidence += 0.12;
  if (timeMatch?.exact) confidence += 0.12;
  if (location) confidence += 0.07;
  if (participants.length > 0) confidence += 0.06;
  if (clause.includes('要') || clause.includes('得')) confidence += 0.04;
  return Math.min(0.97, Number(confidence.toFixed(2)));
}

function buildStartTime(date, timeMatch) {
  if (!date || !timeMatch?.exact) return null;
  const next = new Date(date);
  next.setHours(timeMatch.hour, timeMatch.minute || 0, 0, 0);
  return formatLocalDateTime(next);
}

function buildEndTime(date, timeMatch) {
  if (!date || !timeMatch?.exact || !Number.isFinite(timeMatch.endHour)) return null;
  const next = new Date(date);
  next.setHours(timeMatch.endHour, timeMatch.endMinute || 0, 0, 0);
  return formatLocalDateTime(next);
}

function normalizeHour(hour, meridiem) {
  if (!meridiem) return hour;
  if (['下午', '晚上', '今晚', '傍晚'].includes(meridiem) && hour < 12) return hour + 12;
  if (meridiem === '中午' && hour < 11) return hour + 12;
  if (meridiem === '凌晨' && hour === 12) return 0;
  return hour;
}

function buildDedupeKey({ title, dateText, startTime, location }) {
  return [
    normalizeKey(title),
    normalizeKey(startTime || dateText || ''),
    normalizeKey(location || ''),
  ].join('::');
}

function normalizeConfidence(value, { temporal, location, participants }) {
  let confidence = Number(value);
  if (!Number.isFinite(confidence)) confidence = 0.62;
  if (temporal.startTime) confidence = Math.max(confidence, 0.78);
  if (location) confidence += 0.04;
  if (participants.length > 0) confidence += 0.04;
  return Math.min(0.97, Number(confidence.toFixed(2)));
}

function formatScheduleCandidateRow(row) {
  return {
    id: row.id,
    sourceMessageId: row.source_message_id,
    title: row.title,
    startTime: formatDateTime(row.start_time),
    endTime: formatDateTime(row.end_time),
    dateText: row.date_text || '',
    location: row.location || '',
    participants: safeParse(row.participants_json, []),
    confidence: Number(row.confidence || 0),
    status: row.status,
    meta: safeParse(row.meta_json, {}),
    createdAt: formatDateTime(row.created_at),
    updatedAt: formatDateTime(row.updated_at),
    confirmedAt: formatDateTime(row.confirmed_at),
    dismissedAt: formatDateTime(row.dismissed_at),
  };
}

function splitClauses(text) {
  return text
    .split(/[\n，,。！？!?；;]|然后|接着|之后/)
    .map((item) => cleanupText(item))
    .filter(Boolean);
}

function normalizeText(text) {
  return cleanupText(String(text || '').replace(/\s+/g, ' '));
}

function cleanupText(text) {
  return String(text || '')
    .replace(/[“”"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripDurationRanges(text) {
  return cleanupText(text)
    .replace(/(\d+)\s*[-–~到至]\s*(\d+)\s*分钟/g, ' ')
    .replace(/持续\s*(\d+)\s*[-–~到至]\s*(\d+)\s*分钟/g, ' ')
    .replace(/(\d+)\s*分钟/g, ' ');
}

function normalizeAssistantPlanLine(line) {
  return cleanupText(String(line || '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/^\s*[-*]\s*/, '')
    .replace(/^\s*[-*]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/__+/g, '')
  );
}

const ASSISTANT_PERIOD_PATTERN = /(早晨|早上|上午|午餐后|中午|下午|晚上|睡前|今晚|夜里|比赛前|演讲前)(?=\s*[:：]|$|）|\))/;

function isAssistantPracticeNoise(text) {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  if (normalized.length < 4) return true;
  if (/^(希望|如果|如有|有其他需要|随时告诉我|加油|这个日程|这个安排)/.test(normalized)) return true;
  if (/(帮助你缓解焦虑|增强自信|希望这个日程|有其他需要|随时告诉我|你一定会|如果你有其他需要)/.test(normalized)) return true;
  if (!/(练习|复习|冥想|散步|深呼吸|伸展|阅读|音乐|模拟演讲|写下|早餐|喝水|喝温水|自我激励|自我暗示|正念)/.test(normalized)) return true;
  return false;
}

function normalizeKey(text) {
  return cleanupText(text).toLowerCase();
}

function safeParse(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseChineseNumber(raw) {
  const normalized = String(raw || '').trim();
  if (!normalized) return NaN;
  if (/^\d+$/.test(normalized)) return Number(normalized);

  const map = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (normalized === '十') return 10;
  if (normalized.includes('十')) {
    const [tensRaw, onesRaw] = normalized.split('十');
    const tens = tensRaw ? (map[tensRaw] || 0) : 1;
    const ones = onesRaw ? (map[onesRaw] || 0) : 0;
    return tens * 10 + ones;
  }
  return map[normalized] ?? NaN;
}

function nextWeekday(now, weekdayChar, forceNextWeek) {
  const weekdayMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
  const target = weekdayMap[weekdayChar];
  const current = now.getDay();
  let diff = (target - current + 7) % 7;
  if (diff === 0 || forceNextWeek) diff += 7;
  return addDays(now, diff);
}

function addDays(date, days) {
  const next = stripTime(date);
  next.setDate(next.getDate() + days);
  return next;
}

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateTime(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const normalized = value.replace('T', ' ').replace(/\.\d+Z?$/, '');
    return normalized.length >= 19 ? normalized.slice(0, 19) : normalized;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatLocalDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function buildDisplayDateText(dateMatch, timeMatch) {
  if (!dateMatch?.date) return dateMatch?.text || '';
  const absoluteDate = formatMonthDay(dateMatch.date);
  const relativeLabel = isRelativeDateLabel(dateMatch.text) ? `（${dateMatch.text}）` : '';
  return [absoluteDate + relativeLabel, timeMatch?.text].filter(Boolean).join(' ').trim();
}

function formatMonthDay(date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日`;
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isRelativeDateLabel(text) {
  return /今天|今晚|今早|今晨|明天|明早|明晚|后天|大后天|下周|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]/.test(String(text || ''));
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

function clampPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// DEFAULT_PERIOD_TIMES maps a period label to its default hour for schedule storage.
const DEFAULT_PERIOD_TIMES = { '早上': 8, '上午': 9, '中午': 12, '下午': 14, '晚上': 19, '睡前': 21 };

/**
 * LLM-based extraction for wellness/recovery plans from ANY assistant reply format.
 * Works regardless of whether the AI used "周一至周五" markdown or "今天晚上7点" format.
 * Returns practice-suggestion objects ready to pass to saveWellnessPractices().
 */
async function extractWellnessPlanFromReply({ content, now = new Date() }) {
  const normalized = (content || '').trim();
  if (!normalized) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const endpoint = `${OPENAI_BASE_URL}/chat/completions`;
  const nowDate = now instanceof Date ? now : new Date(now);
  const today = stripTime(nowDate);
  const dateLabels = {
    [formatDateKey(today)]: '今天',
    [formatDateKey(addDays(today, 1))]: '明天',
    [formatDateKey(addDays(today, 2))]: '后天',
    [formatDateKey(addDays(today, 3))]: '大后天',
  };
  const dateOptions = Object.keys(dateLabels).join('、');

  const prompt = [
    '你是一个健康日程提取器。从以下对话内容中提取所有健康/康复活动，并为每个活动分配一个从今天开始的具体日期和时间段。',
    '只返回 JSON，不要解释。',
    `输出格式：{"items":[{"title":"活动名称","date":"YYYY-MM-DD","period":"晚上","hour":19}]}`,
    '规则：',
    `- date 只能从以下选取：${dateOptions}`,
    '- period 只能是：早上、上午、中午、下午、晚上、睡前',
    '- hour 是整数，对应 period 的合理默认时间（早上=8，上午=9，中午=12，下午=14，晚上=19，睡前=21）',
    '- title 要简短具体，例如"散步15分钟""深呼吸练习""冥想10分钟""写下感受"，不超过20字',
    '- 把周期性活动（如"每天"）分配到今天和明天各一次，不要重复同一个活动超过2次',
    '- 最多提取6个活动，优先选今天和明天',
    '- 如果内容涉及心理康复/情绪调节/压力管理主题但没有列出明确活动，则主动生成3个适合的基础康复活动（深呼吸/散步/写下感受），分配到今天',
    '- 如果内容完全与健康无关，返回 {"items":[]}',
    '',
    `当前日期: ${formatDateKey(today)}`,
    `对话内容：${normalized}`,
  ].join('\n');

  try {
    const response = await axios.post(
      endpoint,
      {
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: '你只返回严格 JSON。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 400,
        response_format: { type: 'json_object' },
      },
      {
        timeout: SCHEDULE_EXTRACTION_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        ...buildProxyConfig(endpoint),
      }
    );

    const raw = response.data?.choices?.[0]?.message?.content || '{}';
    const parsed = safeParse(raw, {});
    const items = Array.isArray(parsed.items) ? parsed.items : [];

    return items
      .filter((item) => item && item.title && item.date && item.period)
      .map((item) => {
        const hour = Number.isFinite(Number(item.hour)) ? Number(item.hour) : (DEFAULT_PERIOD_TIMES[item.period] || 8);
        const dateObj = new Date(`${item.date}T${String(hour).padStart(2, '0')}:00:00`);
        return {
          title: String(item.title).slice(0, 60),
          description: `Suggested from wellness recovery plan · ${item.period}`,
          recommendedTime: item.period,
          actionPrompt: `Help me do this next: ${item.title}`,
          status: 'pending',
          completedAt: null,
          saved: false,
          suggestionDate: item.date,
          startTime: isNaN(dateObj.getTime()) ? null : dateObj.toISOString().slice(0, 19).replace('T', ' '),
        };
      })
      .slice(0, 6);
  } catch {
    return [];
  }
}

module.exports = {
  ensureScheduleCandidateSchema,
  createCandidatesForMessage,
  createCandidatesFromAssistantReply,
  extractCandidatesForTurn,
  listCandidatesForUser,
  listCandidatesForMessages,
  confirmCandidate,
  dismissCandidate,
  updateCandidate,
  extractScheduleCandidates,
  extractScheduleCandidatesWithFallback,
  extractAssistantPlanCandidates,
  extractWellnessPlanFromReply,
};
