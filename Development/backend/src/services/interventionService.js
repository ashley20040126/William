const db = require('../utils/db');

const INTERVENTION_TYPES = new Set([
  'grounding',
  'breathing',
  'journaling',
  'reframing',
  'difficult_conversation_script',
  'task_breakdown',
  'sleep_reset',
  'boundary_prompt',
  'reflection_question',
]);

async function ensureInterventionSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS intervention_outcomes (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      session_id BIGINT UNSIGNED NOT NULL,
      user_message_id BIGINT UNSIGNED NULL,
      assistant_message_id BIGINT UNSIGNED NULL,
      intervention_type VARCHAR(48) NOT NULL,
      suggestion_summary VARCHAR(220) NOT NULL,
      target_loop_id BIGINT UNSIGNED NULL,
      target_memory_id BIGINT UNSIGNED NULL,
      accepted_signal ENUM('none','explicit_accept','explicit_reject','behavior_followthrough') NOT NULL DEFAULT 'none',
      followup_signal VARCHAR(64) NULL,
      self_report_delta DECIMAL(5,2) NULL,
      stress_delta_window DECIMAL(5,2) NULL,
      outcome_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      status ENUM('pending','observed','ineffective') NOT NULL DEFAULT 'pending',
      meta_json JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_intervention_time (user_id, created_at),
      INDEX idx_user_intervention_type (user_id, intervention_type, updated_at),
      INDEX idx_user_intervention_status (user_id, status, updated_at),
      INDEX idx_session_intervention (session_id, created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_intervention_preferences (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      intervention_type VARCHAR(48) NOT NULL,
      evidence_count INT UNSIGNED NOT NULL DEFAULT 0,
      positive_count INT UNSIGNED NOT NULL DEFAULT 0,
      negative_count INT UNSIGNED NOT NULL DEFAULT 0,
      acceptance_count INT UNSIGNED NOT NULL DEFAULT 0,
      followthrough_count INT UNSIGNED NOT NULL DEFAULT 0,
      avg_outcome_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      effectiveness_label ENUM('helpful','mixed','avoid','unknown') NOT NULL DEFAULT 'unknown',
      summary VARCHAR(220) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_intervention_type (user_id, intervention_type),
      INDEX idx_user_effectiveness (user_id, effectiveness_label, avg_outcome_score),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

async function captureAssistantInterventions({
  userId,
  sessionId,
  userMessageId,
  assistantMessageId,
  userContent = '',
  assistantContent = '',
  activeLoops = [],
}) {
  const candidates = detectInterventionsFromReply({
    reply: assistantContent,
    userContent,
    activeLoops,
  });

  if (candidates.length === 0) {
    return [];
  }

  const created = [];
  for (const candidate of candidates) {
    const [result] = await db.execute(
      `INSERT INTO intervention_outcomes (
         user_id, session_id, user_message_id, assistant_message_id, intervention_type, suggestion_summary,
         target_loop_id, accepted_signal, followup_signal, self_report_delta, stress_delta_window, outcome_score, status, meta_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'none', NULL, NULL, NULL, 0.00, 'pending', ?)`,
      [
        userId,
        sessionId,
        userMessageId || null,
        assistantMessageId || null,
        candidate.interventionType,
        candidate.suggestionSummary,
        candidate.targetLoopId || null,
        JSON.stringify({
          keywords: candidate.keywords || [],
          extractedFrom: 'assistant_reply',
        }),
      ]
    );

    created.push({
      id: result.insertId,
      interventionType: candidate.interventionType,
      suggestionSummary: candidate.suggestionSummary,
      targetLoopId: candidate.targetLoopId || null,
    });
  }

  if (created.length > 0) {
    await recomputeUserInterventionPreferences(userId);
  }

  return created;
}

async function captureChatFollowupSignals({
  userId,
  sessionId,
  userContent = '',
}) {
  const normalized = normalizeText(userContent);
  if (!normalized) return [];

  const [rows] = await db.execute(
    `SELECT id, intervention_type, suggestion_summary, outcome_score, status, meta_json, created_at
     FROM intervention_outcomes
     WHERE user_id = ? AND session_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
     ORDER BY id DESC
     LIMIT 12`,
    [userId, sessionId]
  );

  if (rows.length === 0) {
    return [];
  }

  const updates = [];
  for (const row of rows) {
    const signal = detectChatFollowupSignal(normalized, row.intervention_type);
    if (!signal) continue;

    const currentScore = Number(row.outcome_score || 0);
    const nextScore = clampOutcomeScore(currentScore + signal.scoreDelta);
    const nextStatus = signal.scoreDelta < 0 ? 'ineffective' : 'observed';

    await db.execute(
      `UPDATE intervention_outcomes
       SET accepted_signal = CASE
             WHEN accepted_signal = 'behavior_followthrough' THEN accepted_signal
             ELSE ?
           END,
           followup_signal = ?,
           outcome_score = ?,
           status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        signal.acceptedSignal,
        signal.followupSignal,
        nextScore,
        nextStatus,
        row.id,
      ]
    );

    updates.push({
      id: row.id,
      interventionType: row.intervention_type,
      followupSignal: signal.followupSignal,
      outcomeScore: nextScore,
      status: nextStatus,
    });

    if (signal.acceptedSignal === 'explicit_reject') {
      break;
    }
  }

  if (updates.length > 0) {
    await recomputeUserInterventionPreferences(userId);
  }

  return updates;
}

async function recordBehaviorEvent({
  userId,
  eventType,
  eventPayload = {},
}) {
  const rules = resolveBehaviorRules(eventType, eventPayload);
  if (rules.length === 0) return [];

  const [rows] = await db.execute(
    `SELECT id, intervention_type, outcome_score, status, created_at
     FROM intervention_outcomes
     WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
     ORDER BY id DESC
     LIMIT 24`,
    [userId]
  );

  const updated = [];
  for (const row of rows) {
    const matchingRule = rules.find((rule) => rule.types.includes(row.intervention_type));
    if (!matchingRule) continue;

    const nextScore = clampOutcomeScore(Number(row.outcome_score || 0) + matchingRule.scoreDelta);
    const nextStatus = matchingRule.scoreDelta < 0 ? 'ineffective' : 'observed';

    await db.execute(
      `UPDATE intervention_outcomes
       SET accepted_signal = CASE
             WHEN ? = 1 THEN 'behavior_followthrough'
             WHEN accepted_signal = 'none' THEN 'explicit_accept'
             ELSE accepted_signal
           END,
           followup_signal = ?,
           outcome_score = ?,
           status = ?,
           self_report_delta = CASE
             WHEN ? IS NULL THEN self_report_delta
             ELSE ?
           END,
           stress_delta_window = CASE
             WHEN ? IS NULL THEN stress_delta_window
             ELSE ?
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        matchingRule.behaviorFollowthrough ? 1 : 0,
        matchingRule.followupSignal,
        nextScore,
        nextStatus,
        matchingRule.selfReportDelta,
        matchingRule.selfReportDelta,
        matchingRule.stressDelta,
        matchingRule.stressDelta,
        row.id,
      ]
    );

    updated.push({
      id: row.id,
      interventionType: row.intervention_type,
      followupSignal: matchingRule.followupSignal,
      outcomeScore: nextScore,
      status: nextStatus,
    });
  }

  if (updated.length > 0) {
    await recomputeUserInterventionPreferences(userId);
  }

  return updated;
}

async function getUserInterventionOverview({ userId, limit = 6 }) {
  const queryLimit = clampPositiveInt(limit, 6);
  const [preferenceRows, outcomeRows] = await Promise.all([
    db.execute(
      `SELECT intervention_type, evidence_count, positive_count, negative_count, acceptance_count,
              followthrough_count, avg_outcome_score, effectiveness_label, summary, updated_at
       FROM user_intervention_preferences
       WHERE user_id = ?
       ORDER BY FIELD(effectiveness_label, 'helpful', 'mixed', 'avoid', 'unknown'), avg_outcome_score DESC, evidence_count DESC
       LIMIT ${queryLimit}`,
      [userId]
    ),
    db.execute(
      `SELECT id, intervention_type, suggestion_summary, accepted_signal, followup_signal, outcome_score, status, created_at, updated_at
       FROM intervention_outcomes
       WHERE user_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT ${Math.max(queryLimit, 6)}`,
      [userId]
    ),
  ]);

  const preferences = preferenceRows[0].map(mapPreferenceRow);
  const topHelpful = preferences.filter((item) => item.effectivenessLabel === 'helpful').slice(0, 3);
  const avoid = preferences.filter((item) => item.effectivenessLabel === 'avoid').slice(0, 2);

  return {
    preferences,
    topHelpful,
    avoid,
    recentOutcomes: outcomeRows[0].map(mapOutcomeRow),
  };
}

async function buildInterventionEfficacyContext({ userId, intent = 'general_support' }) {
  const overview = await getUserInterventionOverview({ userId, limit: 8 });
  const allowedTypes = getRelevantInterventionTypes(intent);
  const helpful = filterPreferencesByIntent(overview.topHelpful, allowedTypes);
  const avoid = filterPreferencesByIntent(overview.avoid, allowedTypes);

  if (helpful.length === 0 && avoid.length === 0) {
    return {
      section: '',
      overview,
    };
  }

  const lines = ['【支持方式效果偏好】'];
  if (helpful.length > 0) {
    lines.push(`- 当前更可优先考虑：${helpful.map((item) => item.summary || formatPreferenceShort(item)).join('；')}`);
  }
  if (avoid.length > 0) {
    lines.push(`- 当前不宜优先依赖：${avoid.map((item) => item.summary || formatPreferenceShort(item)).join('；')}`);
  }
  lines.push('- 这些只是倾向，不要机械套模板；若当前输入与历史规律冲突，以当前输入为准。');

  return {
    section: lines.join('\n'),
    overview,
  };
}

async function recomputeUserInterventionPreferences(userId) {
  const [rows] = await db.execute(
    `SELECT intervention_type,
            COUNT(*) AS evidence_count,
            SUM(CASE WHEN outcome_score >= 0.35 THEN 1 ELSE 0 END) AS positive_count,
            SUM(CASE WHEN outcome_score <= -0.2 THEN 1 ELSE 0 END) AS negative_count,
            SUM(CASE WHEN accepted_signal IN ('explicit_accept', 'behavior_followthrough') THEN 1 ELSE 0 END) AS acceptance_count,
            SUM(CASE WHEN accepted_signal = 'behavior_followthrough' THEN 1 ELSE 0 END) AS followthrough_count,
            AVG(outcome_score) AS avg_outcome_score
     FROM intervention_outcomes
     WHERE user_id = ?
     GROUP BY intervention_type`,
    [userId]
  );

  for (const row of rows) {
    const avg = Number(row.avg_outcome_score || 0);
    const evidenceCount = Number(row.evidence_count || 0);
    const positiveCount = Number(row.positive_count || 0);
    const negativeCount = Number(row.negative_count || 0);
    const acceptanceCount = Number(row.acceptance_count || 0);
    const followthroughCount = Number(row.followthrough_count || 0);
    const effectivenessLabel = resolveEffectivenessLabel({
      avgOutcomeScore: avg,
      evidenceCount,
      positiveCount,
      negativeCount,
    });
    const summary = buildPreferenceSummary({
      interventionType: row.intervention_type,
      effectivenessLabel,
      acceptanceCount,
      followthroughCount,
    });

    await db.execute(
      `INSERT INTO user_intervention_preferences (
         user_id, intervention_type, evidence_count, positive_count, negative_count, acceptance_count,
         followthrough_count, avg_outcome_score, effectiveness_label, summary
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         evidence_count = VALUES(evidence_count),
         positive_count = VALUES(positive_count),
         negative_count = VALUES(negative_count),
         acceptance_count = VALUES(acceptance_count),
         followthrough_count = VALUES(followthrough_count),
         avg_outcome_score = VALUES(avg_outcome_score),
         effectiveness_label = VALUES(effectiveness_label),
         summary = VALUES(summary),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        row.intervention_type,
        evidenceCount,
        positiveCount,
        negativeCount,
        acceptanceCount,
        followthroughCount,
        Number(avg.toFixed(2)),
        effectivenessLabel,
        summary,
      ]
    );
  }
}

function detectInterventionsFromReply({ reply = '', userContent = '', activeLoops = [] }) {
  const normalizedReply = normalizeText(reply);
  if (!normalizedReply) return [];

  const candidates = [];
  const targetLoopId = resolvePrimaryTargetLoopId(activeLoops, userContent);
  const hasTaskBreakdownSignal = /(第一步|第二步|先做这一步|拆成|最小动作|今天先只做)/.test(normalizedReply);
  const hasGroundingSignal = /(脚踩地|踩地|看一看周围|找五样|此刻你看到|让身体落地|ground)/.test(normalizedReply);
  const hasBreathingWord = /(呼吸|吸气|呼气|屏住|breath|呼吸四拍|慢慢吐气)/.test(normalizedReply);
  const hasBreathingInstruction = /(吸气|呼气|屏住|数到|四拍|六拍|八拍|慢慢吐气|跟着这个节奏)/.test(normalizedReply);
  const hasScriptSignal = /(你可以这样说|你可以直接发|可以直接回|参考这句|这句话可以发|先发这句|直接发第一句|把这句发给)/.test(normalizedReply);
  const hasSleepContext = /(睡|失眠|休息)/.test(normalizedReply + normalizeText(userContent));
  const hasSleepResetAction = /(睡前先|今晚先|起床后先|先别继续刷|先去躺下|别看时间|把灯调暗|离开床|喝两口水|先把手机放下)/.test(normalizedReply);
  const hasBoundaryInstruction = /(你可以拒绝|你可以不答应|先不用答应|先不承诺|先回到你的节奏|先守住边界|这就是你的边界)/.test(normalizedReply);

  if (hasGroundingSignal) {
    candidates.push(makeCandidate('grounding', reply, targetLoopId, ['grounding']));
  }
  if (hasBreathingWord && hasBreathingInstruction) {
    candidates.push(makeCandidate('breathing', reply, targetLoopId, ['breathing']));
  }
  const hasJournalingSignal = /(写下来|写一写|记下来|journal|日记里|写成三句|写成一段)/.test(normalizedReply) && !hasTaskBreakdownSignal;
  if (hasJournalingSignal) {
    candidates.push(makeCandidate('journaling', reply, targetLoopId, ['writing']));
  }
  if (/(换句话说|更准确地说|未必等于|这更像是|不一定说明)/.test(normalizedReply)) {
    candidates.push(makeCandidate('reframing', reply, targetLoopId, ['reframing']));
  }
  if (hasScriptSignal) {
    candidates.push(makeCandidate('difficult_conversation_script', reply, targetLoopId, ['script']));
  }
  if (hasTaskBreakdownSignal) {
    candidates.push(makeCandidate('task_breakdown', reply, targetLoopId, ['steps']));
  }
  if (hasSleepResetAction && hasSleepContext) {
    candidates.push(makeCandidate('sleep_reset', reply, targetLoopId, ['sleep']));
  }
  if (hasBoundaryInstruction) {
    candidates.push(makeCandidate('boundary_prompt', reply, targetLoopId, ['boundary']));
  }
  if (!hasJournalingSignal && /(你可以先回答|先问自己|你最想|如果只挑一个|先想想)/.test(normalizedReply)) {
    candidates.push(makeCandidate('reflection_question', reply, targetLoopId, ['reflection']));
  }

  return dedupeCandidates(candidates);
}

function detectChatFollowupSignal(normalizedUserContent, interventionType) {
  if (/(没用|没啥用|不适合我|做不到|我不想|先别|别再说这个|没帮助)/.test(normalizedUserContent)) {
    return {
      acceptedSignal: 'explicit_reject',
      followupSignal: 'user_rejected',
      scoreDelta: -0.45,
    };
  }

  if (/(我试了|我照做了|我做了|我已经做了|我刚刚做了|我发了|我刚刚发了|我写了|我刚刚写了|我去做了|我发出去了)/.test(normalizedUserContent)) {
    return {
      acceptedSignal: 'behavior_followthrough',
      followupSignal: resolveFollowupSignalForType(interventionType, true),
      scoreDelta: 0.55,
    };
  }

  const isQuestionLike = /[?？]/.test(normalizedUserContent) || /(你可以|可以帮|可以给|行吗|可以吗)/.test(normalizedUserContent);
  if (!isQuestionLike && /(好，我试试|我试试看|有用|这有帮助|我懂了|行，我先这样|好，我先这样|可以，我试试|可以，我先这样)/.test(normalizedUserContent)) {
    return {
      acceptedSignal: 'explicit_accept',
      followupSignal: 'user_accepted',
      scoreDelta: 0.25,
    };
  }

  return null;
}

function resolveBehaviorRules(eventType, eventPayload) {
  switch (eventType) {
    case 'journal_saved':
      return [
        makeBehaviorRule(['journaling', 'reflection_question', 'reframing'], 'journal_saved', 0.45, true, null, eventPayload.selfReportDelta ?? null),
      ];
    case 'practice_completed':
      return resolvePracticeRules(eventPayload.practiceId);
    case 'schedule_confirmed':
      return [
        makeBehaviorRule(['difficult_conversation_script', 'task_breakdown', 'boundary_prompt'], 'schedule_confirmed', 0.4, true),
      ];
    case 'active_loop_resolved':
      return [
        makeBehaviorRule(['task_breakdown', 'difficult_conversation_script', 'boundary_prompt', 'sleep_reset'], 'active_loop_resolved', 0.5, true),
      ];
    case 'mood_logged':
      if (typeof eventPayload.stressDelta !== 'number') return [];
      return [
        makeBehaviorRule(
          filterInterventionTypesByIntentHint(eventPayload.intentHint),
          'mood_shift',
          eventPayload.stressDelta < 0 ? 0.25 : -0.15,
          false,
          eventPayload.stressDelta,
          null
        ),
      ];
    default:
      return [];
  }
}

function resolvePracticeRules(practiceId) {
  const normalized = normalizeText(practiceId);
  if (!normalized) return [];

  if (/(anchor|ground|breath|breathe|scan|reset)/.test(normalized)) {
    return [
      makeBehaviorRule(['grounding', 'breathing', 'sleep_reset'], 'practice_completed', 0.45, true),
    ];
  }
  if (/(journal|write|reflect)/.test(normalized)) {
    return [
      makeBehaviorRule(['journaling', 'reflection_question', 'reframing'], 'practice_completed', 0.45, true),
    ];
  }
  return [
    makeBehaviorRule(['task_breakdown', 'grounding', 'reframing'], 'practice_completed', 0.25, true),
  ];
}

function makeBehaviorRule(types, followupSignal, scoreDelta, behaviorFollowthrough, stressDelta = null, selfReportDelta = null) {
  return {
    types,
    followupSignal,
    scoreDelta,
    behaviorFollowthrough,
    stressDelta,
    selfReportDelta,
  };
}

function resolveEffectivenessLabel({ avgOutcomeScore, evidenceCount, positiveCount, negativeCount }) {
  if (evidenceCount < 2) return 'unknown';
  if (avgOutcomeScore >= 0.4 && positiveCount >= negativeCount) return 'helpful';
  if (avgOutcomeScore <= -0.2 && negativeCount >= positiveCount) return 'avoid';
  return 'mixed';
}

function buildPreferenceSummary({ interventionType, effectivenessLabel, acceptanceCount, followthroughCount }) {
  const label = interventionLabel(interventionType);
  if (effectivenessLabel === 'helpful') {
    if (followthroughCount > 0) return `${label}更容易被采纳并继续执行`;
    return `${label}更容易被用户接受`;
  }
  if (effectivenessLabel === 'avoid') {
    return `${label}近期较少起作用，或更容易被跳过`;
  }
  if (acceptanceCount > 0) {
    return `${label}有时有效，但稳定性一般`;
  }
  return `${label}目前证据还不够稳定`;
}

function interventionLabel(interventionType) {
  const map = {
    grounding: '落地稳定类提示',
    breathing: '呼吸类提示',
    journaling: '写下来/记录类提示',
    reframing: '认知重述类提示',
    difficult_conversation_script: '困难对话脚本',
    task_breakdown: '任务拆解',
    sleep_reset: '睡眠重置建议',
    boundary_prompt: '边界表达提示',
    reflection_question: '反思式提问',
  };
  return map[interventionType] || interventionType;
}

function formatPreferenceShort(item) {
  return `${interventionLabel(item.interventionType)}（${item.effectivenessLabel}）`;
}

function resolvePrimaryTargetLoopId(activeLoops = [], userContent = '') {
  if (!Array.isArray(activeLoops) || activeLoops.length === 0) return null;
  const normalizedUserContent = normalizeText(userContent);
  const matched = activeLoops.find((loop) => {
    const haystack = normalizeText([loop.title, loop.summary].filter(Boolean).join(' '));
    return haystack && normalizedUserContent && overlap(haystack, normalizedUserContent);
  });
  return matched?.id || activeLoops[0]?.id || null;
}

function makeCandidate(interventionType, reply, targetLoopId, keywords) {
  if (!INTERVENTION_TYPES.has(interventionType)) return null;
  return {
    interventionType,
    suggestionSummary: cleanSnippet(reply, 220),
    targetLoopId: targetLoopId || null,
    keywords,
  };
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate) return false;
    if (seen.has(candidate.interventionType)) return false;
    seen.add(candidate.interventionType);
    return true;
  });
}

function mapPreferenceRow(row) {
  return {
    interventionType: row.intervention_type,
    evidenceCount: Number(row.evidence_count || 0),
    positiveCount: Number(row.positive_count || 0),
    negativeCount: Number(row.negative_count || 0),
    acceptanceCount: Number(row.acceptance_count || 0),
    followthroughCount: Number(row.followthrough_count || 0),
    avgOutcomeScore: Number(row.avg_outcome_score || 0),
    effectivenessLabel: row.effectiveness_label,
    summary: row.summary || '',
    updatedAt: row.updated_at || null,
  };
}

function mapOutcomeRow(row) {
  return {
    id: row.id,
    interventionType: row.intervention_type,
    suggestionSummary: row.suggestion_summary,
    acceptedSignal: row.accepted_signal,
    followupSignal: row.followup_signal || '',
    outcomeScore: Number(row.outcome_score || 0),
    status: row.status,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function resolveFollowupSignalForType(interventionType, followthrough = false) {
  if (!followthrough) return 'user_accepted';
  const map = {
    journaling: 'journal_completed',
    difficult_conversation_script: 'message_or_script_used',
    task_breakdown: 'next_step_done',
    boundary_prompt: 'boundary_action_taken',
    grounding: 'grounding_practice_done',
    breathing: 'breathing_practice_done',
    sleep_reset: 'sleep_reset_tried',
    reframing: 'reframe_used',
    reflection_question: 'reflection_completed',
  };
  return map[interventionType] || 'behavior_followthrough';
}

function normalizeText(text) {
  return String(text || '').trim().toLowerCase();
}

function clampOutcomeScore(score) {
  return Number(Math.max(-1, Math.min(1, score)).toFixed(2));
}

function cleanSnippet(text, maxLength) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function clampPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function overlap(a, b) {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a) || longestKeywordOverlap(a, b);
}

function longestKeywordOverlap(a, b) {
  const keywords = ['妈妈', '爸爸', '伴侣', '老板', '睡眠', '焦虑', '沟通', '开口', '复诊', '面试', '工作', '关系'];
  return keywords.some((keyword) => a.includes(keyword) && b.includes(keyword));
}

function getRelevantInterventionTypes(intent = 'general_support') {
  const map = {
    file_or_url_followup: [],
    memory_audit: [],
    schedule_logistics: ['task_breakdown'],
    sleep_recovery: ['sleep_reset', 'breathing', 'grounding'],
    relationship_conversation: ['difficult_conversation_script', 'boundary_prompt', 'task_breakdown', 'reflection_question'],
    active_problem_solving: ['task_breakdown', 'reframing', 'difficult_conversation_script', 'boundary_prompt'],
    emotional_support: ['grounding', 'breathing', 'reframing', 'journaling', 'reflection_question'],
    general_support: ['grounding', 'breathing', 'reframing', 'task_breakdown', 'reflection_question'],
  };

  return map[intent] || map.general_support;
}

function filterPreferencesByIntent(preferences = [], allowedTypes = []) {
  if (!Array.isArray(allowedTypes) || allowedTypes.length === 0) return [];
  const allowed = new Set(allowedTypes);
  return preferences.filter((item) => allowed.has(item.interventionType)).slice(0, 2);
}

function filterInterventionTypesByIntentHint(intentHint = '') {
  const filtered = getRelevantInterventionTypes(intentHint);
  return filtered.length > 0 ? filtered : [...INTERVENTION_TYPES];
}

module.exports = {
  ensureInterventionSchema,
  captureAssistantInterventions,
  captureChatFollowupSignals,
  recordBehaviorEvent,
  getUserInterventionOverview,
  buildInterventionEfficacyContext,
  __test: {
    detectInterventionsFromReply,
    detectChatFollowupSignal,
  },
};
