const crypto = require('crypto');

const db = require('../utils/db');
const engine = require('./behaviorEngine');
const { ensureChatSchema } = require('./chatSchemaService');
const scheduleCandidateService = require('./scheduleCandidateService');
const {
  withTransaction,
  createServiceError,
  safeJsonParse,
} = require('./userServiceUtils');

const AMBIENT_HIDDEN_USER_PREFIX = '[[ambient-listening-digest]]';

async function ensureAmbientListeningSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ambient_listening_events (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      transcript TEXT NULL,
      transcript_hash CHAR(40) NULL,
      event_hash CHAR(40) NOT NULL,
      token_count INT UNSIGNED DEFAULT 0,
      analysis_json JSON,
      source_page VARCHAR(40),
      source_session_key VARCHAR(80),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ambient_user_time (user_id, created_at),
      INDEX idx_ambient_hash (user_id, transcript_hash),
      INDEX idx_ambient_event_hash (user_id, event_hash),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await ensureColumn(
    'users',
    'ambient_asr_enabled',
    'ALTER TABLE users ADD COLUMN ambient_asr_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER memory_enabled'
  );
  await ensureColumn(
    'ambient_listening_events',
    'event_hash',
    'ALTER TABLE ambient_listening_events ADD COLUMN event_hash CHAR(40) NULL AFTER transcript_hash'
  );
  await db.query('ALTER TABLE ambient_listening_events MODIFY COLUMN transcript TEXT NULL');
  await db.query('ALTER TABLE ambient_listening_events MODIFY COLUMN transcript_hash CHAR(40) NULL');
  await db.query('UPDATE ambient_listening_events SET event_hash = COALESCE(NULLIF(transcript_hash, \'\'), SHA1(CONCAT(\'legacy:\', id))) WHERE event_hash IS NULL OR event_hash = \'\'');
  await ensureIndex(
    'ambient_listening_events',
    'idx_ambient_event_hash',
    'CREATE INDEX idx_ambient_event_hash ON ambient_listening_events (user_id, event_hash)'
  );

  await ensureColumn(
    'day_profiles',
    'ambient_stress_avg',
    'ALTER TABLE day_profiles ADD COLUMN ambient_stress_avg DECIMAL(4,2) NULL AFTER chat_peak'
  );
  await ensureColumn(
    'day_profiles',
    'ambient_stress_peak',
    'ALTER TABLE day_profiles ADD COLUMN ambient_stress_peak DECIMAL(4,2) NULL AFTER ambient_stress_avg'
  );
  await ensureColumn(
    'day_profiles',
    'ambient_listening_count',
    'ALTER TABLE day_profiles ADD COLUMN ambient_listening_count INT UNSIGNED DEFAULT 0 AFTER ambient_stress_peak'
  );
  await ensureColumn(
    'day_profiles',
    'ambient_transcript_tokens',
    'ALTER TABLE day_profiles ADD COLUMN ambient_transcript_tokens INT UNSIGNED DEFAULT 0 AFTER ambient_listening_count'
  );
}

async function recordAmbientListeningEvent({
  userId,
  transcript,
  eventHash,
  sourcePage = 'app',
  sourceSessionKey = '',
  analysis = null,
}) {
  const normalizedTranscript = normalizeTranscript(transcript);
  const hasTranscript = normalizedTranscript.length >= 6;
  const transcriptHash = hasTranscript
    ? crypto.createHash('sha1').update(normalizedTranscript).digest('hex')
    : null;
  const tokenCount = countTranscriptTokens(normalizedTranscript);
  const resolvedAnalysis = normalizeAnalysisPayload(analysis, hasTranscript ? normalizedTranscript : '', tokenCount);

  if (!resolvedAnalysis) {
    throw createServiceError('Transcript could not be analyzed');
  }
  const resolvedEventHash = normalizeEventHash(eventHash, transcriptHash, resolvedAnalysis, sourcePage, sourceSessionKey);

  const today = new Date().toISOString().split('T')[0];
  const dow = new Date().toLocaleDateString('en', { weekday: 'long' });

  return withTransaction(async (conn) => {
    const [existingRows] = await conn.execute(
      `SELECT id
       FROM ambient_listening_events
       WHERE user_id = ? AND event_hash = ? AND created_at >= (NOW() - INTERVAL 5 MINUTE)
       LIMIT 1`,
      [userId, resolvedEventHash]
    );

    if (existingRows[0]) {
      return {
        ok: true,
        deduped: true,
        analysis: resolvedAnalysis,
      };
    }

    await conn.execute(
      `INSERT INTO ambient_listening_events (
         user_id, transcript, transcript_hash, event_hash, token_count, analysis_json, source_page, source_session_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        hasTranscript ? normalizedTranscript : null,
        transcriptHash,
        resolvedEventHash,
        tokenCount,
        JSON.stringify(resolvedAnalysis),
        sourcePage.slice(0, 40) || 'app',
        sourceSessionKey.slice(0, 80) || null,
      ]
    );

    const [dayRows] = await conn.execute(
      `SELECT ambient_stress_avg, ambient_stress_peak, ambient_listening_count, ambient_transcript_tokens
       FROM day_profiles
       WHERE user_id = ? AND date = ?
       LIMIT 1`,
      [userId, today]
    );

    const nextStress = Number(resolvedAnalysis.stress || 0);
    const currentCount = Number(dayRows[0]?.ambient_listening_count || 0);
    const currentTokens = Number(dayRows[0]?.ambient_transcript_tokens || 0);
    const currentAvg = dayRows[0]?.ambient_stress_avg == null ? null : Number(dayRows[0].ambient_stress_avg);
    const currentPeak = dayRows[0]?.ambient_stress_peak == null ? null : Number(dayRows[0].ambient_stress_peak);

    const nextCount = currentCount + 1;
    const nextTokens = currentTokens + tokenCount;
    const nextAvg = currentAvg == null
      ? nextStress
      : ((currentAvg * currentCount) + nextStress) / nextCount;
    const nextPeak = currentPeak == null ? nextStress : Math.max(currentPeak, nextStress);

    await conn.execute(
      `INSERT INTO day_profiles (
         user_id, date, day_of_week, ambient_stress_avg, ambient_stress_peak, ambient_listening_count, ambient_transcript_tokens
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         ambient_stress_avg = VALUES(ambient_stress_avg),
         ambient_stress_peak = VALUES(ambient_stress_peak),
         ambient_listening_count = VALUES(ambient_listening_count),
         ambient_transcript_tokens = VALUES(ambient_transcript_tokens)`,
      [
        userId,
        today,
        dow,
        round2(nextAvg),
        round2(nextPeak),
        nextCount,
        nextTokens,
      ]
    );

    return {
      ok: true,
      deduped: false,
      analysis: resolvedAnalysis,
    };
  });
}

async function getAmbientListeningSummary(userId, days = 7) {
  const limit = Math.max(1, Math.min(30, Number(days) || 7));
  const [rows] = await db.query(
    `SELECT date, ambient_stress_avg, ambient_stress_peak, ambient_listening_count, ambient_transcript_tokens
     FROM day_profiles
     WHERE user_id = ? AND ambient_listening_count > 0
     ORDER BY date DESC
     LIMIT ${limit}`,
    [userId]
  );
  return rows;
}

async function finalizeAmbientListeningSession({
  userId,
  startedAt,
  sourceSessionKey = '',
}) {
  await ensureAmbientListeningSchema();
  await ensureChatSchema();
  await scheduleCandidateService.ensureScheduleCandidateSchema();

  const startedAtDate = normalizeStartedAt(startedAt);
  if (!startedAtDate) {
    throw createServiceError('startedAt is required', 400);
  }

  const endedAtDate = new Date();
  const todayKey = formatDateKey(endedAtDate);
  const yesterdayKey = shiftDateKey(todayKey, -1);

  const [userRows, sessionRows, windowRows, yesterdayRows, existingSuggestionRows] = await Promise.all([
    db.execute('SELECT id, name, voice_mode FROM users WHERE id = ? LIMIT 1', [userId]).then(([rows]) => rows),
    db.execute(
      'SELECT id, session_key FROM chat_sessions WHERE user_id = ? AND session_key = ? LIMIT 1',
      [userId, String(sourceSessionKey || '').trim() || `ambient_review_${todayKey}`]
    ).then(([rows]) => rows),
    db.execute(
      `SELECT id, created_at, transcript, token_count, analysis_json
       FROM ambient_listening_events
       WHERE user_id = ? AND created_at >= ? AND created_at <= ?
       ORDER BY created_at ASC`,
      [userId, startedAtDate, endedAtDate]
    ).then(([rows]) => rows),
    db.execute(
      `SELECT created_at, token_count, analysis_json
       FROM ambient_listening_events
       WHERE user_id = ? AND DATE(created_at) = ?
       ORDER BY created_at ASC`,
      [userId, yesterdayKey]
    ).then(([rows]) => rows),
    db.execute(
      `SELECT id
       FROM ai_practice_suggestions
       WHERE user_id = ? AND suggestion_date = ?
       ORDER BY id ASC
       LIMIT 1`,
      [userId, todayKey]
    ).then(([rows]) => rows),
  ]);
  const user = userRows[0] || null;

  if (!user) {
    throw createServiceError('User not found', 404);
  }
  if (!windowRows.length) {
    return {
      ok: true,
      created: false,
      reason: 'no_new_events',
      assistantMessage: null,
      practiceSuggestion: null,
      scheduleCandidates: [],
    };
  }

  const sessionKey = String(sourceSessionKey || '').trim() || `ambient_review_${todayKey}`;
  let sessionId = Number(sessionRows?.[0]?.id || 0);
  if (!sessionId) {
    const [inserted] = await db.execute(
      'INSERT INTO chat_sessions (user_id, session_key, is_temporary) VALUES (?, ?, 0)',
      [userId, sessionKey]
    );
    sessionId = Number(inserted.insertId);
  }

  const voiceInsight = summarizeVoiceInsight(windowRows, yesterdayRows, todayKey);
  const combinedTranscript = collectAmbientTranscript(windowRows);
  const transcriptAnalysis = combinedTranscript ? engine.analyzeText(combinedTranscript) : null;
  const scheduleSourceText = combinedTranscript || buildScheduleSourceFallback(voiceInsight);
  const scheduleCandidates = [];

  let hiddenSourceMessageId = null;
  if (scheduleSourceText) {
    const [userMessageResult] = await db.execute(
      'INSERT INTO chat_messages (session_id, user_id, role, content, voice_id) VALUES (?, ?, ?, ?, ?)',
      [
        sessionId,
        userId,
        'user',
        `${AMBIENT_HIDDEN_USER_PREFIX} ${scheduleSourceText}`.slice(0, 3000),
        user.voice_mode || 'classic',
      ]
    );
    hiddenSourceMessageId = Number(userMessageResult.insertId);
  }

  if (hiddenSourceMessageId && combinedTranscript) {
    try {
      const createdCandidates = await scheduleCandidateService.createCandidatesForMessage({
        userId,
        sessionId,
        sourceMessageId: hiddenSourceMessageId,
        content: combinedTranscript,
      });
      scheduleCandidates.push(...createdCandidates);
    } catch (error) {
      console.error('[Ambient Listening] Schedule candidate generation error:', error.message);
    }
  }

  const practicePayload = buildAmbientPracticePayload({
    voiceInsight,
    transcriptAnalysis,
    combinedTranscript,
    todayKey,
  });

  let practiceSuggestionId = null;
  if (existingSuggestionRows?.[0]?.id) {
    practiceSuggestionId = Number(existingSuggestionRows[0].id);
    await db.execute(
      `UPDATE ai_practice_suggestions
       SET title = ?, description = ?, suggestion_type = ?, trigger_label = ?, recommended_time = ?,
           action_prompt = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [
        practicePayload.title,
        practicePayload.description,
        practicePayload.suggestionType,
        practicePayload.triggerLabel,
        practicePayload.recommendedTime,
        practicePayload.actionPrompt,
        JSON.stringify(practicePayload.metadata || {}),
        practiceSuggestionId,
        userId,
      ]
    );
  } else {
    const [insertedSuggestion] = await db.execute(
      `INSERT INTO ai_practice_suggestions
        (user_id, suggestion_date, title, description, suggestion_type, trigger_label, recommended_time, action_prompt, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        todayKey,
        practicePayload.title,
        practicePayload.description,
        practicePayload.suggestionType,
        practicePayload.triggerLabel,
        practicePayload.recommendedTime,
        practicePayload.actionPrompt,
        JSON.stringify(practicePayload.metadata || {}),
      ]
    );
    practiceSuggestionId = Number(insertedSuggestion.insertId);
  }

  const assistantText = buildAmbientAssistantInsight({
    userName: user.name || 'there',
    voiceInsight,
    transcriptAnalysis,
    combinedTranscript,
    practiceTitle: practicePayload.title,
    scheduleCount: scheduleCandidates.length,
  });
  const [assistantMessageResult] = await db.execute(
    'INSERT INTO chat_messages (session_id, user_id, role, content, voice_id) VALUES (?, ?, ?, ?, ?)',
    [
      sessionId,
      userId,
      'assistant',
      assistantText,
      user.voice_mode || 'classic',
    ]
  );

  return {
    ok: true,
    created: true,
    assistantMessage: {
      id: Number(assistantMessageResult.insertId),
      role: 'assistant',
      content: assistantText,
      ts: new Date().toISOString(),
      voiceId: user.voice_mode || 'classic',
    },
    voiceInsight,
    practiceSuggestion: {
      id: practiceSuggestionId,
      title: practicePayload.title,
      description: practicePayload.description,
    },
    scheduleCandidates,
  };
}

async function getTodayVoiceInsight(userId, dateKey = null) {
  const targetDate = normalizeDateKey(dateKey) || new Date().toISOString().slice(0, 10);
  const yesterdayDate = shiftDateKey(targetDate, -1);

  const [todayRows] = await db.execute(
    `SELECT created_at, token_count, analysis_json
     FROM ambient_listening_events
     WHERE user_id = ? AND DATE(created_at) = ?
     ORDER BY created_at ASC`,
    [userId, targetDate]
  );
  if (!todayRows.length) {
    return null;
  }

  const [yesterdayRows] = await db.execute(
    `SELECT created_at, token_count, analysis_json
     FROM ambient_listening_events
     WHERE user_id = ? AND DATE(created_at) = ?
     ORDER BY created_at ASC`,
    [userId, yesterdayDate]
  );

  return summarizeVoiceInsight(todayRows, yesterdayRows, targetDate);
}

function formatAmbientAnalysis(analysis, tokenCount) {
  return {
    emotion: analysis.dominantEmotion || 'neutral',
    stress: Number(analysis.stressEstimate || 0),
    patterns: Array.isArray(analysis.cognitivePatterns) ? analysis.cognitivePatterns : [],
    topics: Array.isArray(analysis.topics) ? analysis.topics : [],
    tokenCount,
  };
}

function normalizeAnalysisPayload(analysis, transcript, tokenCount) {
  if (analysis && typeof analysis === 'object') {
    const normalized = {
      emotion: String(analysis.emotion || analysis.dominantEmotion || 'neutral'),
      stress: Number(analysis.stress ?? analysis.stressEstimate ?? 0),
      patterns: Array.isArray(analysis.patterns) ? analysis.patterns : Array.isArray(analysis.cognitivePatterns) ? analysis.cognitivePatterns : [],
      topics: Array.isArray(analysis.topics) ? analysis.topics : [],
      tokenCount: Number(analysis.tokenCount || tokenCount || 0),
      transcript: transcript || null,
    };

    if (analysis.speechPace != null) normalized.speechPace = Number(analysis.speechPace);
    if (analysis.stability != null) normalized.stability = Number(analysis.stability);
    if (analysis.vocalVitality != null) normalized.vocalVitality = Number(analysis.vocalVitality);
    if (Array.isArray(analysis.flags)) normalized.flags = analysis.flags;
    if (analysis.durationMs != null) normalized.durationMs = Number(analysis.durationMs);
    return normalized;
  }

  const textAnalysis = engine.analyzeText(transcript);
  if (!textAnalysis) return null;
  return formatAmbientAnalysis(textAnalysis, tokenCount);
}

function normalizeTranscript(transcript) {
  return String(transcript || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countTranscriptTokens(transcript) {
  if (!transcript) return 0;
  const words = transcript.split(/\s+/).filter(Boolean).length;
  const cjk = (transcript.match(/[\u4e00-\u9fff]/g) || []).length;
  return Math.max(words, cjk, 1);
}

function normalizeEventHash(eventHash, transcriptHash, analysis, sourcePage, sourceSessionKey) {
  const normalizedEventHash = String(eventHash || '').trim().toLowerCase();
  if (/^[a-f0-9]{40}$/.test(normalizedEventHash)) {
    return normalizedEventHash;
  }
  if (transcriptHash) {
    return transcriptHash;
  }
  return crypto.createHash('sha1')
    .update(JSON.stringify({
      sourcePage: String(sourcePage || '').slice(0, 40),
      sourceSessionKey: String(sourceSessionKey || '').slice(0, 80),
      emotion: String(analysis?.emotion || ''),
      stress: round2(Number(analysis?.stress || 0)),
      speechPace: analysis?.speechPace == null ? null : round2(Number(analysis.speechPace)),
      durationMs: analysis?.durationMs == null ? null : Math.round(Number(analysis.durationMs)),
      flags: Array.isArray(analysis?.flags) ? analysis.flags.map((flag) => String(flag)) : [],
    }))
    .digest('hex');
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function summarizeVoiceInsight(todayRows, yesterdayRows, dateKey) {
  const todayEvents = todayRows.map(toAmbientEvent).filter(Boolean);
  const yesterdayEvents = yesterdayRows.map(toAmbientEvent).filter(Boolean);
  if (!todayEvents.length) return null;

  const totalTokens = todayEvents.reduce((sum, event) => sum + event.tokenCount, 0);
  const stressValues = todayEvents.map((event) => event.stress).filter(isFiniteNumber);
  const stabilityValues = todayEvents.map((event) => event.stability).filter(isFiniteNumber);
  const yesterdayStabilityValues = yesterdayEvents.map((event) => event.stability).filter(isFiniteNumber);
  const spikeWindows = collapseStressWindows(todayEvents.filter((event) => event.stress >= 6.8));

  const averageStability = mean(stabilityValues);
  const yesterdayAverageStability = mean(yesterdayStabilityValues);
  const stabilityDelta = averageStability != null && yesterdayAverageStability != null
    ? round2(averageStability - yesterdayAverageStability)
    : null;

  let stabilityDirection = 'unknown';
  if (stabilityDelta != null) {
    if (stabilityDelta <= -0.35) stabilityDirection = 'lower';
    else if (stabilityDelta >= 0.35) stabilityDirection = 'higher';
    else stabilityDirection = 'similar';
  }

  const speakingStyle = totalTokens <= 24
    ? 'quiet'
    : totalTokens >= 120
      ? 'talkative'
      : 'balanced';

  const dominantEmotion = pickDominantEmotion(todayEvents);
  const averageStress = mean(stressValues);
  const severity = spikeWindows.length >= 2 || stabilityDirection === 'lower'
    ? 'warning'
    : spikeWindows.length === 0 && stabilityDirection === 'higher'
      ? 'positive'
      : 'neutral';

  return {
    date: dateKey,
    severity,
    sampleCount: todayEvents.length,
    transcriptTokens: totalTokens,
    averageStress: averageStress == null ? null : round2(averageStress),
    highStressWindowCount: spikeWindows.length,
    highStressWindows: spikeWindows.map((event) => formatClockLabel(event.createdAt)),
    stabilityAverage: averageStability == null ? null : round2(averageStability),
    yesterdayStabilityAverage: yesterdayAverageStability == null ? null : round2(yesterdayAverageStability),
    stabilityDelta,
    stabilityDirection,
    speakingStyle,
    dominantEmotion,
  };
}

function toAmbientEvent(row) {
  const analysis = safeJsonParse(row.analysis_json, {});
  if (!analysis || typeof analysis !== 'object') return null;

  const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  if (Number.isNaN(createdAt.getTime())) return null;

  return {
    createdAt,
    tokenCount: Number(row.token_count || 0),
    stress: Number(analysis.stress ?? 0),
    stability: analysis.stability == null ? null : Number(analysis.stability),
    vocalVitality: analysis.vocalVitality == null ? null : Number(analysis.vocalVitality),
    emotion: String(analysis.emotion || 'neutral'),
  };
}

function collapseStressWindows(events) {
  if (!events.length) return [];
  const windows = [events[0]];

  for (let index = 1; index < events.length; index += 1) {
    const current = events[index];
    const previous = windows[windows.length - 1];
    const minuteGap = Math.abs(current.createdAt.getTime() - previous.createdAt.getTime()) / 60000;
    if (minuteGap >= 45) {
      windows.push(current);
      continue;
    }
    if ((current.stress || 0) > (previous.stress || 0)) {
      windows[windows.length - 1] = current;
    }
  }

  return windows.slice(0, 3);
}

function pickDominantEmotion(events) {
  const counts = new Map();
  events.forEach((event) => {
    const key = String(event.emotion || 'neutral').trim().toLowerCase();
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  let topKey = 'neutral';
  let topCount = 0;
  counts.forEach((count, key) => {
    if (count > topCount) {
      topKey = key;
      topCount = count;
    }
  });
  return topKey;
}

function mean(values) {
  const valid = values.filter(isFiniteNumber);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatClockLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function normalizeDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
}

function shiftDateKey(dateKey, deltaDays) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function normalizeStartedAt(value) {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function collectAmbientTranscript(rows) {
  return rows
    .map((row) => String(row.transcript || '').replace(AMBIENT_HIDDEN_USER_PREFIX, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1800);
}

function buildScheduleSourceFallback(voiceInsight) {
  if (!voiceInsight) return '';
  if (voiceInsight.highStressWindows.length > 0) {
    return `High-pressure windows near ${voiceInsight.highStressWindows.join(', ')}.`;
  }
  return '';
}

function buildAmbientPracticePayload({
  voiceInsight,
  transcriptAnalysis,
  combinedTranscript,
  todayKey,
}) {
  const lowerTranscript = String(combinedTranscript || '').toLowerCase();
  const boundaryLike = /需求|meeting|会议|同事|老板|客户|request|deadline|overwhelm|边界|拒绝|say no/.test(lowerTranscript);

  if (boundaryLike || transcriptAnalysis?.stressEstimate >= 7) {
    return {
      title: '5分钟呼吸练习',
      description: '帮助你从刚才的高压时段恢复，并把身体从持续警觉里带下来。',
      suggestionType: 'ambient_recovery',
      triggerLabel: 'ambient listening',
      recommendedTime: 'Now',
      actionPrompt: '带我做一个 5 分钟的呼吸恢复练习，帮我从刚才的高压状态里退下来。',
      metadata: {
        date: todayKey,
        source: 'ambient_finalize',
        highStressWindowCount: Number(voiceInsight?.highStressWindowCount || 0),
      },
    };
  }

  return {
    title: 'Take a short decompression walk',
    description: 'Use a few quiet minutes away from the room to lower conversational load and reset.',
    suggestionType: 'ambient_recovery',
    triggerLabel: 'ambient listening',
    recommendedTime: 'Soon',
    actionPrompt: 'Help me use a short walk to reset after the conversations around me.',
    metadata: {
      date: todayKey,
      source: 'ambient_finalize',
      highStressWindowCount: Number(voiceInsight?.highStressWindowCount || 0),
    },
  };
}

function buildAmbientAssistantInsight({
  userName,
  voiceInsight,
  transcriptAnalysis,
  combinedTranscript,
  practiceTitle,
  scheduleCount,
}) {
  const windows = Array.isArray(voiceInsight?.highStressWindows) ? voiceInsight.highStressWindows.filter(Boolean) : [];
  const windowText = windows.length > 0 ? ` around ${windows.join(' and ')}` : '';
  const stabilityLine = voiceInsight?.stabilityDirection === 'lower'
    ? 'Your voice sounded less stable than yesterday.'
    : voiceInsight?.stabilityDirection === 'higher'
      ? 'Your voice sounded steadier than yesterday.'
      : 'Your voice rhythm stayed fairly similar to yesterday.';
  const emotion = transcriptAnalysis?.dominantEmotion || voiceInsight?.dominantEmotion || 'stress';
  const transcriptHint = combinedTranscript
    ? inferAmbientThemeFromTranscript(combinedTranscript)
    : '';
  const scheduleLine = scheduleCount > 0
    ? ` I also turned ${scheduleCount} possible plan${scheduleCount > 1 ? 's' : ''} into schedule suggestions for you to confirm in Today.`
    : '';

  return [
    `I listened quietly in the background and noticed ${voiceInsight?.highStressWindowCount || 0} high-pressure window${Number(voiceInsight?.highStressWindowCount || 0) === 1 ? '' : 's'}${windowText}. ${stabilityLine}`,
    transcriptHint
      ? `${transcriptHint} The strongest emotional tone coming through sounded closest to ${emotion}.`
      : `The strongest emotional tone coming through sounded closest to ${emotion}.`,
    `I added "${practiceTitle}" to Today so you have one concrete reset step next.${scheduleLine}`,
  ].join(' ');
}

function inferAmbientThemeFromTranscript(transcript) {
  const text = String(transcript || '').trim();
  if (!text) return '';
  if (/同事|老板|客户|会议|需求|deadline|request|meeting|review/i.test(text)) {
    return 'What I heard points to conversational overload and pressure from other people’s demands.';
  }
  if (/健身|gym|workout|跑步|walk|散步/i.test(text)) {
    return 'What I heard suggests movement or a body-based reset could help carry some of this load.';
  }
  if (/朋友|家人|伴侣|关系|争吵|conflict|relationship/i.test(text)) {
    return 'What I heard suggests relational tension may be part of what is loading you up.';
  }
  return '';
}

async function ensureColumn(tableName, columnName, alterSql) {
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  if (Number(rows[0]?.count || 0) > 0) return;
  await db.query(alterSql);
}

async function ensureIndex(tableName, indexName, createSql) {
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [tableName, indexName]
  );
  if (Number(rows[0]?.count || 0) > 0) return;
  await db.query(createSql);
}

module.exports = {
  ensureAmbientListeningSchema,
  recordAmbientListeningEvent,
  getAmbientListeningSummary,
  getTodayVoiceInsight,
  finalizeAmbientListeningSession,
  AMBIENT_HIDDEN_USER_PREFIX,
};
