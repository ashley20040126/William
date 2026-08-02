const db = require('../utils/db');
const engine = require('./behaviorEngine');
const { extractAssistantPlanCandidates } = require('./scheduleCandidateService');
const {
  safeJsonParse,
  validateNumberParam,
  withTransaction,
  createServiceError,
} = require('./userServiceUtils');
const {
  resolveAttachmentKind,
  extractAttachmentInsight,
  mapAttachmentRow,
} = require('./attachmentService');
const interventionService = require('./interventionService');
const { getTodayVoiceInsight } = require('./ambientListeningService');

let journalColumnSupportPromise = null;
let wellbeingSchemaPromise = null;

function cleanupText(text) {
  return String(text || '')
    .replace(/["""]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const DEFAULT_RECOVERY_PATH_TEMPLATES = [
  {
    id: 'conflict_reset',
    badgeId: 'badge_conflict_reset',
    title: 'Repairing a Frayed Relationship',
    summary: 'Move from looping conflict toward small, emotionally safer repair attempts.',
    icon: '🫶',
    gradient: ['#D46A6A', '#F1B28F'],
    defaultTasks: [
      {
        title: 'Name what still hurts',
        description: 'Write down the part of the conflict that still keeps replaying.',
        kind: 'journal',
        actionPrompt: 'Help me unpack the conflict that is still replaying in my mind.',
        dayOffset: 0,
      },
      {
        title: 'Draft one honest message',
        description: 'Write a short message that names your feeling without escalating the situation.',
        kind: 'outreach',
        actionPrompt: 'Help me draft a calm reconciliation message.',
        dayOffset: 2,
      },
      {
        title: 'Notice your body before contact',
        description: 'Take two minutes to check whether your body feels ready before reaching out.',
        kind: 'somatic',
        actionPrompt: 'Guide me through a short grounding exercise before I reach out to someone.',
        dayOffset: 5,
      },
    ],
  },
  {
    id: 'burnout_boundary',
    badgeId: 'badge_boundary_builder',
    title: 'Rebuilding Boundaries Around Pressure',
    summary: 'Reduce overload by protecting short recovery windows before stress compounds.',
    icon: '🛡️',
    gradient: ['#5873B8', '#8EC5FC'],
    defaultTasks: [
      {
        title: 'Spot the loudest pressure point',
        description: 'Identify which part of your day is draining the most energy right now.',
        kind: 'reflection',
        actionPrompt: 'Help me identify the main source of pressure in my day.',
        dayOffset: 0,
      },
      {
        title: 'Protect one recovery window',
        description: 'Reserve a short buffer between two demanding events.',
        kind: 'schedule',
        actionPrompt: 'Help me design a 15-minute recovery buffer between two stressful commitments.',
        dayOffset: 1,
      },
      {
        title: 'Practice one kind no',
        description: 'Write one sentence you can use to protect your bandwidth this week.',
        kind: 'boundary',
        actionPrompt: 'Help me phrase a kind but clear boundary.',
        dayOffset: 4,
      },
    ],
  },
  {
    id: 'grief_stabilizer',
    badgeId: 'badge_gentle_return',
    title: 'Gentle Return After a Major Loss',
    summary: 'Stabilize after a breakup or major loss through grounding, reflection, and safe connection.',
    icon: '🌱',
    gradient: ['#4C7D6B', '#9ED9C5'],
    defaultTasks: [
      {
        title: 'Make room for the loss',
        description: 'Spend five minutes naming what changed and what still aches.',
        kind: 'reflection',
        actionPrompt: 'Stay with me while I talk through a recent loss.',
        dayOffset: 0,
      },
      {
        title: 'Do one grounding action',
        description: 'Choose one physical action that helps your nervous system come down.',
        kind: 'somatic',
        actionPrompt: 'Guide me through a gentle grounding reset.',
        dayOffset: 2,
      },
      {
        title: 'Reconnect with one safe person',
        description: 'Send one message to someone who feels emotionally safe.',
        kind: 'outreach',
        actionPrompt: 'Help me write a simple message asking for connection.',
        dayOffset: 6,
      },
    ],
  },
  {
    id: 'social_reentry',
    badgeId: 'badge_connection_rebuilder',
    title: 'Re-entering Supportive Connection',
    summary: 'Turn isolation into gradual reconnection with people and routines that feel steadying.',
    icon: '🌤️',
    gradient: ['#E3986D', '#F5D0A9'],
    defaultTasks: [
      {
        title: 'Map your safe people',
        description: 'List the people who usually leave you feeling more grounded.',
        kind: 'mapping',
        actionPrompt: 'Help me identify who feels safe and supportive in my life.',
        dayOffset: 0,
      },
      {
        title: 'Send one low-pressure check-in',
        description: 'Reach out with a message that does not demand a big conversation.',
        kind: 'outreach',
        actionPrompt: 'Help me write a low-pressure check-in message to a friend.',
        dayOffset: 3,
      },
      {
        title: 'Plan one in-person reset',
        description: 'Schedule one walk, tea, or low-stakes meetup with someone supportive.',
        kind: 'schedule',
        actionPrompt: 'Help me plan a small in-person reset with someone supportive.',
        dayOffset: 7,
      },
    ],
  },
  {
    id: 'self_trust',
    badgeId: 'badge_self_trust',
    title: 'Rebuilding Self-Trust Under Stress',
    summary: 'Protect confidence by helping the user keep a few small promises to themselves.',
    icon: '🧭',
    gradient: ['#7B61C9', '#D6A6FF'],
    defaultTasks: [
      {
        title: 'Pick one promise you can keep',
        description: 'Choose one very small action you can realistically follow through on today.',
        kind: 'commitment',
        actionPrompt: 'Help me pick one small promise I can keep today.',
        dayOffset: 0,
      },
      {
        title: 'Complete one guided check-in',
        description: 'Use AI to talk through what almost pulled you off track.',
        kind: 'ai_dialogue',
        actionPrompt: 'I want a deeper check-in about what keeps breaking my self-trust.',
        dayOffset: 2,
      },
      {
        title: 'Record evidence of follow-through',
        description: 'Capture one concrete example that shows you did what you said you would do.',
        kind: 'reflection',
        actionPrompt: 'Help me reflect on one small promise I kept.',
        dayOffset: 5,
      },
    ],
  },
];

const REVIEW_TEMPLATE_KEYWORDS = {
  conflict_reset: ['conflict', 'argu', 'fight', 'tension', '关系', '争吵', '冲突', '冷战', '和好'],
  burnout_boundary: ['burnout', 'overwhelm', 'pressure', 'boss', 'deadline', 'resign', 'quit', '压力', '加班', '老板', '离职', '撑不住'],
  grief_stabilizer: ['breakup', 'grief', 'loss', 'bereave', 'miss them', '分手', '失去', '离开', '难过', '想他', '想她'],
  social_reentry: ['alone', 'isolated', 'lonely', 'withdraw', 'friend', '孤独', '没人', '社交', '朋友', '躲着', '不想见人'],
  self_trust: ['failed', 'guilt', 'shame', 'trust myself', 'self doubt', 'promised', '拖延', '内疚', '羞愧', '做不到', '不相信自己'],
};

async function ensureWellbeingSchema() {
  if (!wellbeingSchemaPromise) {
    wellbeingSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS badges (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL,
          badge_id VARCHAR(30) NOT NULL,
          earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uk_user_badge (user_id, badge_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS practice_completions (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL,
          practice_id VARCHAR(80) NOT NULL,
          source_type ENUM('manual_schedule','ai_suggestion','path_task') NOT NULL DEFAULT 'ai_suggestion',
          source_ref_id BIGINT UNSIGNED,
          time_slot VARCHAR(10),
          xp_awarded TINYINT UNSIGNED DEFAULT 15,
          completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_user_time (user_id, completed_at),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS recovery_path_templates (
          id VARCHAR(40) NOT NULL PRIMARY KEY,
          badge_id VARCHAR(40) NOT NULL,
          title VARCHAR(120) NOT NULL,
          summary TEXT NOT NULL,
          default_tasks JSON NOT NULL,
          icon VARCHAR(10) NOT NULL DEFAULT '🧭',
          gradient JSON NOT NULL,
          sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0
        ) ENGINE=InnoDB
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS user_recovery_paths (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL,
          template_id VARCHAR(40) NOT NULL,
          month_start DATE NOT NULL,
          title VARCHAR(120) NOT NULL,
          summary TEXT NOT NULL,
          stress_source VARCHAR(160) NOT NULL,
          badge_id VARCHAR(40) NOT NULL,
          generation_source ENUM('monthly_planner','daily_ai_review') NOT NULL DEFAULT 'monthly_planner',
          origin_review_id BIGINT UNSIGNED NULL,
          review_reason TEXT NULL,
          status ENUM('active','completed') NOT NULL DEFAULT 'active',
          icon VARCHAR(10) NOT NULL DEFAULT '🧭',
          gradient_json JSON NOT NULL,
          completed_at TIMESTAMP NULL DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_user_month_template (user_id, month_start, template_id),
          INDEX idx_recovery_path_user_month (user_id, month_start, status),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS daily_ai_path_reviews (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL,
          review_date DATE NOT NULL,
          status ENUM('skipped','generated') NOT NULL DEFAULT 'skipped',
          review_summary TEXT,
          signals_json JSON,
          generated_path_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
          banner_title VARCHAR(160),
          banner_body TEXT,
          cta_label VARCHAR(80),
          cta_path VARCHAR(160),
          related_path_id BIGINT UNSIGNED NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_user_review_date (user_id, review_date),
          INDEX idx_review_user_date (user_id, review_date, status),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS recovery_path_tasks (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL,
          user_path_id BIGINT UNSIGNED NOT NULL,
          task_date DATE NOT NULL,
          task_kind VARCHAR(40) NOT NULL,
          title VARCHAR(140) NOT NULL,
          description TEXT NOT NULL,
          action_prompt TEXT,
          sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
          status ENUM('pending','completed') NOT NULL DEFAULT 'pending',
          completed_at TIMESTAMP NULL DEFAULT NULL,
          metadata_json JSON,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_recovery_task_user_date (user_id, task_date, status),
          INDEX idx_recovery_task_path (user_path_id, task_date),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (user_path_id) REFERENCES user_recovery_paths(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS ai_practice_suggestions (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL,
          suggestion_date DATE NOT NULL,
          title VARCHAR(140) NOT NULL,
          description TEXT NOT NULL,
          suggestion_type VARCHAR(40) NOT NULL,
          trigger_label VARCHAR(160),
          recommended_time VARCHAR(40),
          action_prompt TEXT,
          status ENUM('pending','completed') NOT NULL DEFAULT 'pending',
          completed_at TIMESTAMP NULL DEFAULT NULL,
          metadata_json JSON,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_ai_suggestion_user_date (user_id, suggestion_date, status),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS journal_attachments (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          journal_id BIGINT UNSIGNED NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          entry_date DATE NOT NULL,
          kind ENUM('image','document','audio','video','other') NOT NULL DEFAULT 'other',
          status ENUM('uploaded','processing','ready','failed') NOT NULL DEFAULT 'uploaded',
          original_name VARCHAR(255) NOT NULL,
          storage_path VARCHAR(255) NOT NULL,
          mime_type VARCHAR(120) NOT NULL,
          size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
          extracted_text MEDIUMTEXT,
          summary TEXT,
          ocr_text MEDIUMTEXT,
          memory_facts JSON,
          meta_json JSON,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_journal_attachment_journal (journal_id, created_at),
          INDEX idx_journal_attachment_user_date (user_id, entry_date, created_at),
          FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);

      await ensureColumn(
        'user_recovery_paths',
        'generation_source',
        "ALTER TABLE user_recovery_paths ADD COLUMN generation_source ENUM('monthly_planner','daily_ai_review') NOT NULL DEFAULT 'monthly_planner' AFTER badge_id"
      );
      await ensureColumn(
        'user_recovery_paths',
        'origin_review_id',
        'ALTER TABLE user_recovery_paths ADD COLUMN origin_review_id BIGINT UNSIGNED NULL AFTER generation_source'
      );
      await ensureColumn(
        'user_recovery_paths',
        'review_reason',
        'ALTER TABLE user_recovery_paths ADD COLUMN review_reason TEXT NULL AFTER origin_review_id'
      );
      await ensureColumn(
        'practice_completions',
        'source_type',
        "ALTER TABLE practice_completions ADD COLUMN source_type ENUM('manual_schedule','ai_suggestion','path_task') NOT NULL DEFAULT 'ai_suggestion'"
      );
      await ensureColumn(
        'practice_completions',
        'source_ref_id',
        'ALTER TABLE practice_completions ADD COLUMN source_ref_id BIGINT UNSIGNED NULL'
      );
      await ensureColumn(
        'practice_completions',
        'time_slot',
        'ALTER TABLE practice_completions ADD COLUMN time_slot VARCHAR(10) NULL'
      );
      await ensureColumn(
        'practice_completions',
        'xp_awarded',
        'ALTER TABLE practice_completions ADD COLUMN xp_awarded TINYINT UNSIGNED DEFAULT 15'
      );
      await ensureColumn(
        'recovery_path_templates',
        'icon',
        "ALTER TABLE recovery_path_templates ADD COLUMN icon VARCHAR(10) NOT NULL DEFAULT '🧭'"
      );
      await ensureColumn(
        'recovery_path_templates',
        'gradient',
        'ALTER TABLE recovery_path_templates ADD COLUMN gradient JSON NOT NULL'
      );
      await ensureColumn(
        'recovery_path_templates',
        'sort_order',
        'ALTER TABLE recovery_path_templates ADD COLUMN sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0'
      );
      await ensureColumn(
        'user_recovery_paths',
        'icon',
        "ALTER TABLE user_recovery_paths ADD COLUMN icon VARCHAR(10) NOT NULL DEFAULT '🧭'"
      );
      await ensureColumn(
        'user_recovery_paths',
        'gradient_json',
        'ALTER TABLE user_recovery_paths ADD COLUMN gradient_json JSON NOT NULL'
      );
      await ensureColumn(
        'daily_ai_path_reviews',
        'status',
        "ALTER TABLE daily_ai_path_reviews ADD COLUMN status ENUM('generated','dismissed') NOT NULL DEFAULT 'generated'"
      );
      await ensureColumn(
        'daily_ai_path_reviews',
        'generated_path_count',
        'ALTER TABLE daily_ai_path_reviews ADD COLUMN generated_path_count TINYINT UNSIGNED NOT NULL DEFAULT 0'
      );
      await ensureColumn(
        'daily_ai_path_reviews',
        'banner_title',
        'ALTER TABLE daily_ai_path_reviews ADD COLUMN banner_title VARCHAR(160) NOT NULL'
      );
      await ensureColumn(
        'daily_ai_path_reviews',
        'banner_body',
        'ALTER TABLE daily_ai_path_reviews ADD COLUMN banner_body TEXT NOT NULL'
      );
      await ensureColumn(
        'daily_ai_path_reviews',
        'cta_label',
        'ALTER TABLE daily_ai_path_reviews ADD COLUMN cta_label VARCHAR(80) NOT NULL'
      );
      await ensureColumn(
        'daily_ai_path_reviews',
        'cta_path',
        'ALTER TABLE daily_ai_path_reviews ADD COLUMN cta_path VARCHAR(120) NULL'
      );
      await ensureColumn(
        'daily_ai_path_reviews',
        'related_path_id',
        'ALTER TABLE daily_ai_path_reviews ADD COLUMN related_path_id BIGINT UNSIGNED NULL'
      );
      await ensureColumn(
        'recovery_path_tasks',
        'task_kind',
        "ALTER TABLE recovery_path_tasks ADD COLUMN task_kind ENUM('reflection','schedule','boundary','outreach','somatic','review') NOT NULL DEFAULT 'reflection'"
      );
      await ensureColumn(
        'recovery_path_tasks',
        'action_prompt',
        'ALTER TABLE recovery_path_tasks ADD COLUMN action_prompt TEXT NULL'
      );
      await ensureColumn(
        'recovery_path_tasks',
        'metadata_json',
        'ALTER TABLE recovery_path_tasks ADD COLUMN metadata_json JSON NULL'
      );
      await ensureColumn(
        'ai_practice_suggestions',
        'status',
        "ALTER TABLE ai_practice_suggestions ADD COLUMN status ENUM('pending','completed') NOT NULL DEFAULT 'pending'"
      );
      await ensureColumn(
        'ai_practice_suggestions',
        'completed_at',
        'ALTER TABLE ai_practice_suggestions ADD COLUMN completed_at TIMESTAMP NULL DEFAULT NULL'
      );
      await ensureColumn(
        'ai_practice_suggestions',
        'metadata_json',
        'ALTER TABLE ai_practice_suggestions ADD COLUMN metadata_json JSON NULL'
      );
      await ensureColumn(
        'schedule_candidates',
        'todo_status',
        "ALTER TABLE schedule_candidates ADD COLUMN todo_status ENUM('pending','completed') NOT NULL DEFAULT 'pending'"
      );
      await ensureColumn(
        'schedule_candidates',
        'todo_completed_at',
        'ALTER TABLE schedule_candidates ADD COLUMN todo_completed_at TIMESTAMP NULL DEFAULT NULL'
      );
      await ensureColumn(
        'journal_attachments',
        'entry_date',
        'ALTER TABLE journal_attachments ADD COLUMN entry_date DATE NOT NULL AFTER user_id'
      );
      await ensureColumn(
        'journal_attachments',
        'kind',
        "ALTER TABLE journal_attachments ADD COLUMN kind ENUM('image','document','audio','video','other') NOT NULL DEFAULT 'other' AFTER entry_date"
      );
      await ensureColumn(
        'journal_attachments',
        'status',
        "ALTER TABLE journal_attachments ADD COLUMN status ENUM('uploaded','processing','ready','failed') NOT NULL DEFAULT 'uploaded' AFTER kind"
      );
      await ensureColumn(
        'journal_attachments',
        'summary',
        'ALTER TABLE journal_attachments ADD COLUMN summary TEXT NULL'
      );
      await ensureColumn(
        'journal_attachments',
        'meta_json',
        'ALTER TABLE journal_attachments ADD COLUMN meta_json JSON NULL'
      );

    })();
  }
  return wellbeingSchemaPromise;
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, offset) {
  const next = new Date(date);
  next.setDate(next.getDate() + offset);
  return next;
}

function getMonthStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getMonthEnd(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return formatDateKey(value);
  const text = String(value);
  return text.includes('T') ? text.slice(0, 10) : text.slice(0, 10);
}

function toDateTimeOrNull(value) {
  return value ? new Date(value).toISOString() : null;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
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

  if (!rows[0]?.count) {
    await db.execute(alterSql);
  }
}

function inferPrimaryStressors(user, profiles, longitudinal) {
  const signals = [];
  const topTrigger = String(longitudinal?.triggers?.[0]?.trigger || '').trim();
  if (topTrigger) {
    signals.push({
      label: topTrigger,
      reason: 'longitudinal trigger',
    });
  }

  const recentTopics = new Set();
  profiles.slice(-7).forEach((profile) => {
    const sourceTopics = []
      .concat(Array.isArray(profile.chat_topics) ? profile.chat_topics : [])
      .concat(Array.isArray(profile.journal_topics) ? profile.journal_topics : []);
    sourceTopics.forEach((topic) => {
      const text = String(topic || '').trim();
      if (text) recentTopics.add(text);
    });
  });

  for (const topic of recentTopics) {
    if (signals.length >= 5) break;
    if (!signals.find((item) => item.label === topic)) {
      signals.push({ label: topic, reason: 'recent topic' });
    }
  }

  const latestStress = profiles[profiles.length - 1];
  if (toNumber(latestStress?.stress_avg, 0) >= 7 && !signals.find((item) => item.label === 'Workload pressure')) {
    signals.push({ label: 'Workload pressure', reason: 'elevated stress' });
  }

  if (Array.isArray(user?.challenges)) {
    user.challenges.slice(0, 2).forEach((challenge) => {
      const label = `Challenge ${challenge}`;
      if (!signals.find((item) => item.label === label)) {
        signals.push({ label, reason: 'profile challenge' });
      }
    });
  }

  if (signals.length === 0) {
    signals.push({ label: 'Emotional recovery', reason: 'fallback' });
    signals.push({ label: 'Daily pressure', reason: 'fallback' });
  }

  return signals.slice(0, 5);
}

async function getRecoveryPathTemplates(conn = db) {
  try {
    const [rows] = await conn.execute('SELECT * FROM recovery_path_templates ORDER BY sort_order, id');
    if (rows.length === 0) return DEFAULT_RECOVERY_PATH_TEMPLATES;
    return rows.map((row) => ({
      id: row.id,
      badgeId: row.badge_id,
      title: row.title,
      summary: row.summary,
      icon: row.icon,
      gradient: safeJsonParse(row.gradient, ['#7B61C9', '#D6A6FF']),
      defaultTasks: safeJsonParse(row.default_tasks, []),
    }));
  } catch {
    return DEFAULT_RECOVERY_PATH_TEMPLATES;
  }
}

function buildAiSuggestionPayload({ feed, profiles, today }) {
  const latest = profiles[profiles.length - 1] || null;
  const topTrigger = String(feed?.topTrigger || '').trim();
  const stressValue = Math.max(
    toNumber(latest?.stress_avg, 0),
    toNumber(latest?.chat_stress, 0),
    toNumber(latest?.ambient_stress_avg, 0)
  );

  if (topTrigger && /argu|fight|conflict|关系|争吵|分手/i.test(topTrigger)) {
    return {
      title: 'Take a pause before your next emotionally loaded conversation',
      description: 'Between commitments, do a 5-minute walk or breathe outside before replying.',
      suggestionType: 'regulation_break',
      triggerLabel: topTrigger,
      recommendedTime: 'Between meetings',
      actionPrompt: 'Guide me through a short reset before my next difficult conversation.',
      metadata: { date: formatDateKey(today), rationale: 'relationship-trigger' },
    };
  }

  if (stressValue >= 7) {
    return {
      title: 'Insert one nervous-system reset into today',
      description: 'Take 4 slow exhales and release your shoulders before the next task switch.',
      suggestionType: 'nervous_system_reset',
      triggerLabel: topTrigger || 'elevated stress',
      recommendedTime: 'Midday',
      actionPrompt: 'Guide me through a 2-minute nervous system reset.',
      metadata: { date: formatDateKey(today), rationale: 'high-stress' },
    };
  }

  return {
    title: 'Step outdoors for a brief emotional reset',
    description: 'A 10-minute walk between blocks can interrupt rumination and lower load.',
    suggestionType: 'outdoor_walk',
    triggerLabel: topTrigger || 'daily recovery',
    recommendedTime: 'Between blocks',
    actionPrompt: 'Help me use a short outdoor walk to reset my mind.',
    metadata: { date: formatDateKey(today), rationale: 'default-recovery' },
  };
}

async function ensureTodayAiSuggestion(conn, userId, feed, profiles, todayKey) {
  const [existing] = await conn.execute(
    'SELECT id FROM ai_practice_suggestions WHERE user_id = ? AND suggestion_date = ? LIMIT 1',
    [userId, todayKey]
  );
  if (existing.length > 0) return;

  const payload = buildAiSuggestionPayload({ feed, profiles, today: new Date(`${todayKey}T12:00:00`) });
  await conn.execute(
    `INSERT INTO ai_practice_suggestions
      (user_id, suggestion_date, title, description, suggestion_type, trigger_label, recommended_time, action_prompt, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      todayKey,
      payload.title,
      payload.description,
      payload.suggestionType,
      payload.triggerLabel || null,
      payload.recommendedTime || null,
      payload.actionPrompt || null,
      JSON.stringify(payload.metadata || {}),
    ]
  );
}

function buildPracticeSuggestionsFromAssistantReply({
  content,
  todayKey = formatDateKey(new Date()),
  now = new Date(),
}) {
  const extracted = extractAssistantPlanCandidates({ content, now }).filter((candidate) => !candidate.startTime);
  const grouped = new Map();
  for (const candidate of extracted) {
    const resolvedSuggestionDate = normalizeFeedDate(candidate.meta?.parsedDate || todayKey);
    const list = grouped.get(resolvedSuggestionDate) || [];
    if (list.length >= 4) continue;
    list.push(candidate);
    grouped.set(resolvedSuggestionDate, list);
  }

  let runningIndex = 0;
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([resolvedSuggestionDate, candidates]) =>
      candidates.map((candidate) => {
        const index = runningIndex;
        runningIndex += 1;
        const description = candidate.meta?.period
          ? `Suggested from assistant plan · ${candidate.meta.period}`
          : 'Suggested from assistant plan';
        const actionPrompt = `Help me do this next: ${candidate.title}`;
        const recommendedTime = candidate.meta?.period || null;
        return {
          id: `assistant-practice:${resolvedSuggestionDate}:${index}:${normalizePracticeKey(candidate.title)}`,
          rawId: null,
          title: candidate.title,
          description,
          recommendedTime,
          actionPrompt,
          status: 'pending',
          completedAt: null,
          saved: false,
          suggestionDate: resolvedSuggestionDate,
        };
      })
    )
    .slice(0, 12);
}

async function confirmAssistantPracticeSuggestion(userId, payload) {
  const title = cleanupText(payload?.title);
  const description = cleanupText(payload?.description) || 'Suggested from assistant plan';
  const recommendedTime = cleanupText(payload?.recommendedTime || '').slice(0, 80) || null;
  const actionPrompt = cleanupText(payload?.actionPrompt || '').slice(0, 280) || null;
  const suggestionDate = normalizeFeedDate(payload?.suggestionDate);

  if (!title) {
    throw createServiceError('title is required', 400);
  }

  return withTransaction(async (conn) => {
    const [existing] = await conn.execute(
      `SELECT id, title, description, recommended_time, action_prompt, status, completed_at
       FROM ai_practice_suggestions
       WHERE user_id = ? AND suggestion_date = ? AND title = ?
       ORDER BY id DESC
       LIMIT 1`,
      [userId, suggestionDate, title]
    );

    if (existing[0]) {
      return {
        id: `ai:${existing[0].id}`,
        rawId: Number(existing[0].id),
        title: existing[0].title,
        description: existing[0].description,
        recommendedTime: existing[0].recommended_time || null,
        actionPrompt: existing[0].action_prompt || null,
        status: existing[0].status,
        completedAt: toDateTimeOrNull(existing[0].completed_at),
        saved: true,
        suggestionDate,
      };
    }

    const [result] = await conn.execute(
      `INSERT INTO ai_practice_suggestions
        (user_id, suggestion_date, title, description, suggestion_type, trigger_label, recommended_time, action_prompt, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        suggestionDate,
        title,
        description,
        'assistant_plan',
        'assistant_plan',
        recommendedTime,
        actionPrompt,
        JSON.stringify({
          source: 'assistant_plan_v1',
        }),
      ]
    );

    return {
      id: `ai:${result.insertId}`,
      rawId: Number(result.insertId),
      title,
      description,
      recommendedTime,
      actionPrompt,
      status: 'pending',
      completedAt: null,
      saved: true,
      suggestionDate,
    };
  });
}

async function ensureCurrentMonthPaths(conn, userId, user, profiles, longitudinal, todayKey) {
  const monthStart = formatDateKey(getMonthStart(new Date(`${todayKey}T12:00:00`)));
  const [existing] = await conn.execute(
    'SELECT id FROM user_recovery_paths WHERE user_id = ? AND month_start = ? LIMIT 1',
    [userId, monthStart]
  );
  if (existing.length > 0) return;

  const templates = await getRecoveryPathTemplates(conn);
  const stressors = inferPrimaryStressors(user, profiles, longitudinal);
  const pathCount = Math.min(5, Math.max(1, Math.min(templates.length, stressors.length)));
  const today = new Date(`${todayKey}T12:00:00`);
  const monthEnd = getMonthEnd(today);

  for (let index = 0; index < pathCount; index += 1) {
    const template = templates[index % templates.length];
    const stressor = stressors[index] || stressors[0];
    const [result] = await conn.execute(
      `INSERT INTO user_recovery_paths
        (user_id, template_id, month_start, title, summary, stress_source, badge_id, generation_source, icon, gradient_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'monthly_planner', ?, ?)`,
      [
        userId,
        template.id,
        monthStart,
        template.title,
        template.summary,
        stressor.label,
        template.badgeId,
        template.icon,
        JSON.stringify(template.gradient),
      ]
    );

    const pathId = result.insertId;
    const tasks = Array.isArray(template.defaultTasks) && template.defaultTasks.length > 0
      ? template.defaultTasks
      : DEFAULT_RECOVERY_PATH_TEMPLATES[0].defaultTasks;

    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
      const task = tasks[taskIndex];
      let taskDate = addDays(today, Number(task.dayOffset || 0) + index);
      if (taskDate > monthEnd) taskDate = monthEnd;
      await conn.execute(
        `INSERT INTO recovery_path_tasks
          (user_id, user_path_id, task_date, task_kind, title, description, action_prompt, sort_order, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          pathId,
          formatDateKey(taskDate),
          String(task.kind || 'practice'),
          String(task.title || 'Recovery task'),
          String(task.description || ''),
          task.actionPrompt || null,
          taskIndex,
          JSON.stringify({ stressSource: stressor.label }),
        ]
      );
    }
  }
}

async function ensureDailyAiPathReview(conn, userId, user, profiles, longitudinal, todayKey) {
  const [existingReviews] = await conn.execute(
    'SELECT id, status, generated_path_count, banner_title, banner_body, cta_label, cta_path, related_path_id, created_at FROM daily_ai_path_reviews WHERE user_id = ? AND review_date = ? LIMIT 1',
    [userId, todayKey]
  );
  if (existingReviews.length > 0) return existingReviews[0];

  const monthStart = formatDateKey(getMonthStart(new Date(`${todayKey}T12:00:00`)));
  const [chatRows] = await conn.execute(
    `SELECT role, content, created_at
     FROM chat_messages
     WHERE user_id = ? AND created_at >= DATE_SUB(?, INTERVAL 14 DAY)
     ORDER BY created_at DESC
     LIMIT 80`,
    [userId, `${todayKey} 23:59:59`]
  );
  const [journalRows] = await conn.execute(
    `SELECT entry_date, text_content, created_at
     FROM journals
     WHERE user_id = ? AND entry_date >= DATE_SUB(?, INTERVAL 14 DAY)
     ORDER BY entry_date DESC
     LIMIT 20`,
    [userId, todayKey]
  );
  const [practiceRows] = await conn.execute(
    `SELECT source_type, completed_at
     FROM practice_completions
     WHERE user_id = ? AND completed_at >= DATE_SUB(?, INTERVAL 7 DAY)
     ORDER BY completed_at DESC`,
    [userId, `${todayKey} 23:59:59`]
  );
  const [existingPaths] = await conn.execute(
    `SELECT id, template_id, badge_id, status, generation_source, created_at
     FROM user_recovery_paths
     WHERE user_id = ? AND month_start = ?
     ORDER BY created_at DESC`,
    [userId, monthStart]
  );

  const reviewPlan = await buildDailyReviewPlan({
    conn,
    userId,
    user,
    profiles,
    longitudinal,
    todayKey,
    chatRows,
    journalRows,
    practiceRows,
    existingPaths,
  });

  const [reviewInsert] = await conn.execute(
    `INSERT INTO daily_ai_path_reviews
      (user_id, review_date, status, review_summary, signals_json, generated_path_count, banner_title, banner_body, cta_label, cta_path, related_path_id)
     VALUES (?, ?, 'skipped', ?, ?, 0, NULL, NULL, NULL, NULL, NULL)`,
    [
      userId,
      todayKey,
      reviewPlan.summary,
      JSON.stringify(reviewPlan.signals),
    ]
  );

  const reviewId = reviewInsert.insertId;
  const createdPaths = [];
  const monthEnd = getMonthEnd(new Date(`${todayKey}T12:00:00`));
  const templates = await getRecoveryPathTemplates(conn);
  const templateById = new Map(templates.map((template) => [template.id, template]));

  for (let index = 0; index < reviewPlan.candidates.length; index += 1) {
    const candidate = reviewPlan.candidates[index];
    const template = templateById.get(candidate.templateId);
    if (!template) continue;

    const reviewTemplateId = `${template.id}_review_${todayKey.replace(/-/g, '')}_${index + 1}`.slice(0, 40);
    const [pathResult] = await conn.execute(
      `INSERT INTO user_recovery_paths
        (user_id, template_id, month_start, title, summary, stress_source, badge_id, generation_source, origin_review_id, review_reason, icon, gradient_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'daily_ai_review', ?, ?, ?, ?)`,
      [
        userId,
        reviewTemplateId,
        monthStart,
        template.title,
        candidate.summary,
        candidate.stressSource,
        template.badgeId,
        reviewId,
        candidate.reason,
        template.icon,
        JSON.stringify(template.gradient),
      ]
    );

    const pathId = pathResult.insertId;
    const tasks = Array.isArray(template.defaultTasks) && template.defaultTasks.length > 0
      ? template.defaultTasks
      : DEFAULT_RECOVERY_PATH_TEMPLATES[0].defaultTasks;

    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
      const task = tasks[taskIndex];
      let taskDate = addDays(new Date(`${todayKey}T12:00:00`), Number(task.dayOffset || 0));
      if (taskDate > monthEnd) taskDate = monthEnd;
      await conn.execute(
        `INSERT INTO recovery_path_tasks
          (user_id, user_path_id, task_date, task_kind, title, description, action_prompt, sort_order, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          pathId,
          formatDateKey(taskDate),
          String(task.kind || 'practice'),
          String(task.title || 'Recovery task'),
          String(task.description || ''),
          task.actionPrompt || null,
          taskIndex,
          JSON.stringify({
            stressSource: candidate.stressSource,
            origin: 'daily_ai_review',
            reviewDate: todayKey,
          }),
        ]
      );
    }

    createdPaths.push({
      id: pathId,
      title: template.title,
      stressSource: candidate.stressSource,
    });
  }

  const bannerPayload = buildPathReviewBanner(createdPaths);
  await conn.execute(
    `UPDATE daily_ai_path_reviews
     SET status = ?, generated_path_count = ?, banner_title = ?, banner_body = ?, cta_label = ?, cta_path = ?, related_path_id = ?
     WHERE id = ?`,
    [
      createdPaths.length > 0 ? 'generated' : 'skipped',
      createdPaths.length,
      bannerPayload?.title || null,
      bannerPayload?.body || null,
      bannerPayload?.ctaLabel || null,
      bannerPayload?.ctaPath || null,
      bannerPayload?.relatedPathId || null,
      reviewId,
    ]
  );

  return {
    id: reviewId,
    status: createdPaths.length > 0 ? 'generated' : 'skipped',
    generated_path_count: createdPaths.length,
    banner_title: bannerPayload?.title || null,
    banner_body: bannerPayload?.body || null,
    cta_label: bannerPayload?.ctaLabel || null,
    cta_path: bannerPayload?.ctaPath || null,
    related_path_id: bannerPayload?.relatedPathId || null,
    created_at: new Date(),
  };
}

async function buildDailyReviewPlan({
  conn,
  userId,
  user,
  profiles,
  longitudinal,
  todayKey,
  chatRows,
  journalRows,
  practiceRows,
  existingPaths,
}) {
  const templates = await getRecoveryPathTemplates(conn);
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const combinedText = [
    ...chatRows.filter((row) => row.role === 'user').map((row) => row.content),
    ...journalRows.map((row) => row.text_content),
  ]
    .map((text) => String(text || '').trim())
    .filter(Boolean)
    .join(' \n ')
    .toLowerCase();
  const triggerText = String(longitudinal?.triggers?.map((item) => item.trigger).join(' ') || '').toLowerCase();
  const recentStress = profiles.slice(-7);
  const averageStress = recentStress.length > 0
    ? recentStress.reduce((sum, profile) => sum + Math.max(
      toNumber(profile.stress_avg, 0),
      toNumber(profile.chat_stress, 0),
      toNumber(profile.ambient_stress_avg, 0)
    ), 0) / recentStress.length
    : 0;
  const completionCount = practiceRows.length;
  const activeReviewPathCount = existingPaths.filter((path) => path.generation_source === 'daily_ai_review' && path.status === 'active').length;
  const recentReviewBadges = new Set(
    existingPaths
      .filter((path) => path.generation_source === 'daily_ai_review' && daysBetween(path.created_at, `${todayKey}T12:00:00`) <= 7)
      .map((path) => path.badge_id)
  );

  const scored = templates.map((template) => {
    const keywords = REVIEW_TEMPLATE_KEYWORDS[template.id] || [];
    let score = 0;
    const matchedKeywords = keywords.filter((keyword) => combinedText.includes(keyword) || triggerText.includes(keyword));
    score += Math.min(6, matchedKeywords.length * 2);

    if (template.id === 'burnout_boundary' && averageStress >= 6.5) score += 3;
    if (template.id === 'self_trust' && completionCount <= 1) score += 3;
    if (template.id === 'social_reentry' && completionCount === 0) score += 1;
    if (template.id === 'grief_stabilizer' && /breakup|loss|grief|分手|失去|离开/.test(combinedText)) score += 4;
    if (template.id === 'conflict_reset' && /conflict|fight|争吵|冲突|冷战/.test(combinedText)) score += 4;

    return {
      templateId: template.id,
      score,
      matchedKeywords,
      stressSource: inferReviewStressSource({
        templateId: template.id,
        combinedText,
        user,
        longitudinal,
      }),
      summary: buildReviewPathSummary(template.summary, averageStress, completionCount),
      reason: buildReviewReason(template.id, matchedKeywords, averageStress, completionCount),
      badgeId: template.badgeId,
    };
  });

  const candidates = scored
    .filter((item) => item.score >= 4)
    .filter((item) => !recentReviewBadges.has(item.badgeId))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(0, 2 - activeReviewPathCount))
    .map((item) => ({
      templateId: item.templateId,
      stressSource: item.stressSource,
      summary: item.summary,
      reason: item.reason,
    }));

  return {
    summary: buildDailyReviewSummary({ averageStress, completionCount, candidates }),
    signals: {
      averageStress: Math.round(averageStress * 100) / 100,
      completionCount,
      topTrigger: longitudinal?.triggers?.[0]?.trigger || null,
      userMessageCount: chatRows.filter((row) => row.role === 'user').length,
      journalCount: journalRows.length,
    },
    candidates,
  };
}

function inferReviewStressSource({ templateId, combinedText, user, longitudinal }) {
  const topTrigger = String(longitudinal?.triggers?.[0]?.trigger || '').trim();
  if (topTrigger) return topTrigger;
  if (templateId === 'grief_stabilizer' && /breakup|loss|grief|分手|失去/.test(combinedText)) return 'Recent emotional loss';
  if (templateId === 'conflict_reset' && /conflict|argu|fight|争吵|冲突/.test(combinedText)) return 'Relationship conflict';
  if (templateId === 'burnout_boundary' && /boss|deadline|压力|加班|离职/.test(combinedText)) return 'Workload pressure';
  if (templateId === 'social_reentry' && /alone|isolated|lonely|孤独|不想见人/.test(combinedText)) return 'Isolation and social withdrawal';
  if (templateId === 'self_trust' && /guilt|failed|promised|拖延|做不到/.test(combinedText)) return 'Self-trust strain';
  return Array.isArray(user?.challenges) && user.challenges.length > 0
    ? `Challenge ${user.challenges[0]}`
    : 'Recent emotional pressure';
}

function buildReviewPathSummary(baseSummary, averageStress, completionCount) {
  if (averageStress >= 7 && completionCount <= 1) {
    return `${baseSummary} Recent signals suggest the user needs a tighter, more actionable recovery scaffold right now.`;
  }
  if (averageStress >= 6) {
    return `${baseSummary} Recent stress has stayed elevated across several days.`;
  }
  if (completionCount <= 1) {
    return `${baseSummary} Follow-through has been thin this week, so the path should stay concrete and lightweight.`;
  }
  return baseSummary;
}

function buildReviewReason(templateId, matchedKeywords, averageStress, completionCount) {
  const keywordReason = matchedKeywords.length > 0 ? `Matched signals: ${matchedKeywords.slice(0, 3).join(', ')}` : 'Pattern detected from recent review';
  return `${templateId} | stress=${Math.round(averageStress * 10) / 10} | completions=${completionCount} | ${keywordReason}`;
}

function buildDailyReviewSummary({ averageStress, completionCount, candidates }) {
  if (candidates.length === 0) {
    return `Daily AI review skipped new path generation. Stress ${averageStress.toFixed(1)}, completions ${completionCount}. No path threshold crossed.`;
  }
  return `Daily AI review generated ${candidates.length} path${candidates.length > 1 ? 's' : ''}. Stress ${averageStress.toFixed(1)}, completions ${completionCount}.`;
}

function buildPathReviewBanner(createdPaths) {
  if (createdPaths.length === 0) return null;
  if (createdPaths.length === 1) {
    const path = createdPaths[0];
    return {
      title: 'William created a new recovery path for you',
      body: `After reviewing your chats, journal, and recent follow-through, William added "${path.title}" to support ${path.stressSource.toLowerCase()}.`,
      ctaLabel: 'Open new path',
      ctaPath: `/path/${path.id}`,
      relatedPathId: path.id,
    };
  }
  return {
    title: 'William added new recovery paths overnight',
    body: `Your latest chats, journals, and completion patterns triggered ${createdPaths.length} new paths that are now folded into this month.`,
    ctaLabel: 'See new paths',
    ctaPath: '/journey',
    relatedPathId: null,
  };
}

function daysBetween(leftValue, rightValue) {
  const left = new Date(leftValue);
  const right = new Date(rightValue);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return Number.MAX_SAFE_INTEGER;
  return Math.abs(left.getTime() - right.getTime()) / 86400000;
}

async function syncRecoveryPathCompletion(conn, userId, userPathId) {
  const [counts] = await conn.execute(
    `SELECT
       COUNT(*) AS total_tasks,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_tasks
     FROM recovery_path_tasks
     WHERE user_id = ? AND user_path_id = ?`,
    [userId, userPathId]
  );

  const totalTasks = Number(counts[0]?.total_tasks || 0);
  const completedTasks = Number(counts[0]?.completed_tasks || 0);
  if (totalTasks === 0) return null;

  const [[path]] = await conn.execute(
    'SELECT id, badge_id FROM user_recovery_paths WHERE user_id = ? AND id = ? LIMIT 1',
    [userId, userPathId]
  );
  if (!path) return null;

  if (completedTasks >= totalTasks) {
    await conn.execute(
      `UPDATE user_recovery_paths
       SET status = 'completed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
       WHERE user_id = ? AND id = ?`,
      [userId, userPathId]
    );
    await conn.execute(
      'INSERT IGNORE INTO badges (user_id, badge_id) VALUES (?, ?)',
      [userId, path.badge_id]
    );
    return { completed: true, badgeId: path.badge_id };
  }

  await conn.execute(
    `UPDATE user_recovery_paths
     SET status = 'active', completed_at = NULL
     WHERE user_id = ? AND id = ?`,
    [userId, userPathId]
  );
  return { completed: false, badgeId: path.badge_id };
}

async function getMonthlyRecoveryPaths(conn, userId, todayKey) {
  const monthStart = formatDateKey(getMonthStart(new Date(`${todayKey}T12:00:00`)));
  const [paths] = await conn.execute(
    `SELECT *
     FROM user_recovery_paths
     WHERE user_id = ? AND month_start = ?
     ORDER BY created_at ASC, id ASC`,
    [userId, monthStart]
  );

  const [tasks] = await conn.execute(
    `SELECT *
     FROM recovery_path_tasks
     WHERE user_id = ?
       AND user_path_id IN (SELECT id FROM user_recovery_paths WHERE user_id = ? AND month_start = ?)
     ORDER BY task_date ASC, sort_order ASC, id ASC`,
    [userId, userId, monthStart]
  );

  const taskMap = new Map();
  tasks.forEach((task) => {
    const key = Number(task.user_path_id);
    if (!taskMap.has(key)) taskMap.set(key, []);
    taskMap.get(key).push({
      id: `path_task:${task.id}`,
      rawId: Number(task.id),
      title: task.title,
      description: task.description,
      type: task.task_kind,
      taskDate: toDateOnly(task.task_date),
      status: task.status,
      completedAt: toDateTimeOrNull(task.completed_at),
      actionPrompt: task.action_prompt || null,
    });
  });

  return paths.map((path) => {
    const pathTasks = taskMap.get(Number(path.id)) || [];
    const completedCount = pathTasks.filter((task) => task.status === 'completed').length;
    const nextTask = pathTasks.find((task) => task.status !== 'completed') || null;
    return {
      id: String(path.id),
      templateId: path.template_id,
      title: path.title,
      summary: path.summary,
      stressSource: path.stress_source,
      badgeId: path.badge_id,
      badgeLabel: String(path.badge_id || '').replace(/^badge_/, '').replace(/_/g, ' '),
      status: path.status,
      icon: path.icon,
      gradient: safeJsonParse(path.gradient_json, ['#7B61C9', '#D6A6FF']),
      completedAt: toDateTimeOrNull(path.completed_at),
      progress: {
        completed: completedCount,
        total: pathTasks.length,
      },
      nextTask: nextTask ? nextTask.title : null,
      tasks: pathTasks,
    };
  });
}

async function getTodayPracticeTodos(conn, userId, todayKey, monthlyPaths) {
  const [scheduleRows] = await conn.execute(
    `SELECT id, title, location, start_time, todo_status, todo_completed_at
     FROM schedule_candidates
     WHERE user_id = ?
       AND status IN ('confirmed', 'edited')
       AND start_time IS NOT NULL
       AND DATE(start_time) = ?
     ORDER BY start_time ASC, id ASC`,
    [userId, todayKey]
  );

  const [aiRows] = await conn.execute(
    `SELECT id, title, description, suggestion_type, trigger_label, recommended_time, action_prompt, status, completed_at
     FROM ai_practice_suggestions
     WHERE user_id = ? AND suggestion_date = ?
     ORDER BY id ASC`,
    [userId, todayKey]
  );

  const [pathTaskRows] = await conn.execute(
    `SELECT t.id, t.user_path_id, t.title, t.description, t.task_kind, t.action_prompt, t.status, t.completed_at,
            p.title AS path_title
     FROM recovery_path_tasks t
     JOIN user_recovery_paths p ON p.id = t.user_path_id
     WHERE t.user_id = ? AND t.task_date = ?
     ORDER BY t.sort_order ASC, t.id ASC`,
    [userId, todayKey]
  );

  const pathTitleById = new Map(monthlyPaths.map((path) => [Number(path.id), path.title]));
  return [
    ...scheduleRows.map((row) => ({
      id: `schedule:${row.id}`,
      title: row.title,
      description: row.location ? `Planned event · ${row.location}` : 'Planned event',
      sourceType: 'manual_schedule',
      sourceLabel: 'Planned by you',
      typeLabel: 'Schedule',
      status: row.todo_status === 'completed' ? 'completed' : 'pending',
      completedAt: toDateTimeOrNull(row.todo_completed_at),
      timeLabel: row.start_time ? new Date(row.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null,
      pathId: null,
      pathTitle: null,
      actionPrompt: null,
    })),
    ...aiRows.map((row) => ({
      id: `ai:${row.id}`,
      title: row.title,
      description: row.description,
      sourceType: 'ai_suggestion',
      sourceLabel: 'AI recovery suggestion',
      typeLabel: row.suggestion_type || 'AI suggestion',
      status: row.status,
      completedAt: toDateTimeOrNull(row.completed_at),
      timeLabel: row.recommended_time || null,
      pathId: null,
      pathTitle: null,
      actionPrompt: row.action_prompt || null,
    })),
    ...pathTaskRows.map((row) => ({
      id: `path_task:${row.id}`,
      title: row.title,
      description: row.description,
      sourceType: 'path_task',
      sourceLabel: 'Monthly recovery path',
      typeLabel: row.task_kind || 'Path task',
      status: row.status,
      completedAt: toDateTimeOrNull(row.completed_at),
      timeLabel: null,
      pathId: String(row.user_path_id),
      pathTitle: row.path_title || pathTitleById.get(Number(row.user_path_id)) || null,
      actionPrompt: row.action_prompt || null,
    })),
  ];
}

async function getJournalColumnSupport(conn = db) {
  if (!journalColumnSupportPromise) {
    journalColumnSupportPromise = Promise.all([
      conn.query("SHOW COLUMNS FROM journals LIKE 'entry_date'"),
      conn.query("SHOW COLUMNS FROM journals LIKE 'updated_at'"),
    ]).then(([[entryDateColumns], [updatedAtColumns]]) => ({
      hasEntryDate: entryDateColumns.length > 0,
      hasUpdatedAt: updatedAtColumns.length > 0,
    })).catch((err) => {
      journalColumnSupportPromise = null;
      throw err;
    });
  }

  return journalColumnSupportPromise;
}

function resolveJournalDate(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return new Date().toISOString().split('T')[0];
  }

  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw createServiceError('date must be in YYYY-MM-DD format');
  }

  return normalized;
}

function normalizeJournalAttachmentKind(kind = '', mimeType = '') {
  if (kind === 'video' || String(mimeType || '').startsWith('video/')) return 'video';
  if (kind === 'audio') return 'audio';
  if (kind === 'image') return 'image';
  if (kind === 'document') return 'document';
  return 'other';
}

function normalizeJournalAttachmentRow(row) {
  const attachment = mapAttachmentRow(row);
  return {
    ...attachment,
    kind: normalizeJournalAttachmentKind(attachment.kind, attachment.type),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || row.created_at || null,
  };
}

function normalizeJournalEntryRow(row, attachments = []) {
  if (!row) return null;
  const analysis = safeJsonParse(row.analysis, null);
  return {
    id: row.id,
    date: row.entry_date || row.date || row.created_at?.toISOString?.().split('T')[0] || null,
    text: row.text_content || '',
    analysis,
    mood: analysis && typeof analysis.mood === 'number' ? analysis.mood : null,
    stress: analysis && typeof analysis.stress === 'number' ? analysis.stress : null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || row.created_at || null,
    attachments,
  };
}

async function ensureJournalRecord(conn, userId, entryDate) {
  const support = await getJournalColumnSupport(conn);
  let existingRows;

  if (support.hasEntryDate) {
    [existingRows] = await conn.execute(
      `SELECT id
       FROM journals
       WHERE user_id = ? AND entry_date = ?
       ORDER BY ${support.hasUpdatedAt ? 'updated_at DESC,' : ''} created_at DESC
       LIMIT 1`,
      [userId, entryDate]
    );
  } else {
    [existingRows] = await conn.execute(
      `SELECT id
       FROM journals
       WHERE user_id = ? AND DATE(created_at) = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, entryDate]
    );
  }

  if (existingRows.length > 0) {
    return existingRows[0].id;
  }

  if (support.hasEntryDate && support.hasUpdatedAt) {
    const [result] = await conn.execute(
      'INSERT INTO journals (user_id, entry_date, text_content, analysis, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      [userId, entryDate, '', null]
    );
    return result.insertId;
  }

  if (support.hasEntryDate) {
    const [result] = await conn.execute(
      'INSERT INTO journals (user_id, entry_date, text_content, analysis) VALUES (?, ?, ?, ?)',
      [userId, entryDate, '', null]
    );
    return result.insertId;
  }

  const [result] = await conn.execute(
    'INSERT INTO journals (user_id, text_content, analysis) VALUES (?, ?, ?)',
    [userId, '', null]
  );
  return result.insertId;
}

async function listJournalAttachments(userId, entryDate, conn = db) {
  const [rows] = await conn.execute(
    `SELECT id, journal_id, user_id, kind, status, original_name, storage_path, mime_type, size_bytes,
            summary, extracted_text, ocr_text, memory_facts, meta_json, created_at, updated_at
     FROM journal_attachments
     WHERE user_id = ? AND entry_date = ?
     ORDER BY created_at ASC, id ASC`,
    [userId, entryDate]
  );

  return rows.map((row) => normalizeJournalAttachmentRow(row));
}

async function getJournalEntry(userId, date, conn = db) {
  await ensureWellbeingSchema();
  const entryDate = resolveJournalDate(date);
  const support = await getJournalColumnSupport(conn);
  let rows;

  if (support.hasEntryDate) {
    [rows] = await conn.execute(
      `SELECT id, entry_date, text_content, analysis, created_at${support.hasUpdatedAt ? ', updated_at' : ''}
       FROM journals
       WHERE user_id = ? AND entry_date = ?
       ORDER BY ${support.hasUpdatedAt ? 'updated_at DESC,' : ''} created_at DESC
       LIMIT 1`,
      [userId, entryDate]
    );
  } else {
    [rows] = await conn.execute(
      `SELECT id, DATE_FORMAT(created_at, '%Y-%m-%d') AS entry_date, text_content, analysis, created_at
       FROM journals
       WHERE user_id = ? AND DATE(created_at) = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, entryDate]
    );
  }

  const attachments = await listJournalAttachments(userId, entryDate, conn);
  return normalizeJournalEntryRow(rows[0] || null, attachments);
}

async function saveMoodEntry(userId, payload) {
  const { mood, stress, note } = payload;

  if (mood == null || stress == null || Number.isNaN(Number(mood)) || Number.isNaN(Number(stress))) {
    throw createServiceError('mood and stress must be valid numbers');
  }
  if (Number(mood) < 0 || Number(mood) > 10 || Number(stress) < 0 || Number(stress) > 10) {
    throw createServiceError('mood and stress must be between 0-10');
  }

  const noteAnalysis = note ? engine.analyzeText(note) : null;
  const today = new Date().toISOString().split('T')[0];
  const dow = new Date().toLocaleDateString('en', { weekday: 'long' });
  const [previousMoodRows] = await db.execute(
    `SELECT stress
     FROM moods
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  const previousStress = previousMoodRows[0] ? Number(previousMoodRows[0].stress) : null;

  await withTransaction(async (conn) => {
    await conn.execute(
      'INSERT INTO moods (user_id, mood, stress, note, note_analysis) VALUES (?, ?, ?, ?, ?)',
      [userId, Number(mood), Number(stress), note || '', noteAnalysis ? JSON.stringify(noteAnalysis) : null]
    );

    const [moods] = await conn.execute(
      'SELECT mood, stress FROM moods WHERE user_id = ? AND DATE(created_at) = ?',
      [userId, today]
    );

    const moodAvg = moods.length > 0 ? moods.reduce((sum, item) => sum + item.mood, 0) / moods.length : Number(mood);
    const stressAvg = moods.length > 0 ? moods.reduce((sum, item) => sum + item.stress, 0) / moods.length : Number(stress);
    const stressPeak = moods.length > 0 ? Math.max(...moods.map((item) => item.stress)) : Number(stress);

    await conn.execute(
      `INSERT INTO day_profiles (user_id, date, day_of_week, mood_avg, stress_avg, stress_peak, composite_stress)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE mood_avg=?, stress_avg=?, stress_peak=?, composite_stress=?`,
      [userId, today, dow, moodAvg, stressAvg, stressPeak, stressAvg, moodAvg, stressAvg, stressPeak, stressAvg]
    );
  });

  interventionService.recordBehaviorEvent({
    userId,
    eventType: 'mood_logged',
    eventPayload: {
      stressDelta: previousStress == null ? null : Number(stress) - previousStress,
    },
  }).catch((error) => {
    console.error('[Wellbeing] Intervention mood outcome error:', error.message);
  });

  return { ok: true, analysis: noteAnalysis };
}

async function saveJournalEntry(userId, payload) {
  await ensureWellbeingSchema();
  const { text, stress, mood, date } = payload;

  if (!text || typeof text !== 'string' || !text.trim()) {
    throw createServiceError('Journal text cannot be empty');
  }
  if (stress != null && (Number.isNaN(Number(stress)) || Number(stress) < 1 || Number(stress) > 10)) {
    throw createServiceError('stress must be between 1-10');
  }
  if (mood != null && (Number.isNaN(Number(mood)) || Number(mood) < 0 || Number(mood) > 4)) {
    throw createServiceError('mood must be between 0-4');
  }

  const safeText = text.trim().slice(0, 5000);
  const stressValue = stress != null ? Number(stress) : null;
  const moodValue = mood != null ? Number(mood) : null;
  const baseAnalysis = engine.analyzeText(safeText);
  const analysis = {
    ...baseAnalysis,
    ...(moodValue != null ? { mood: moodValue } : {}),
    ...(stressValue != null ? { stress: stressValue } : {}),
  };
  const entryDate = resolveJournalDate(date);
  const entryDay = new Date(`${entryDate}T12:00:00`);
  const dow = entryDay.toLocaleDateString('en', { weekday: 'long' });

  await withTransaction(async (conn) => {
    const support = await getJournalColumnSupport(conn);
    let existingRows;

    if (support.hasEntryDate) {
      [existingRows] = await conn.execute(
        `SELECT id
         FROM journals
         WHERE user_id = ? AND entry_date = ?
         ORDER BY ${support.hasUpdatedAt ? 'updated_at DESC,' : ''} created_at DESC
         LIMIT 1`,
        [userId, entryDate]
      );
    } else {
      [existingRows] = await conn.execute(
        `SELECT id
         FROM journals
         WHERE user_id = ? AND DATE(created_at) = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, entryDate]
      );
    }

    if (existingRows.length > 0) {
      const updateSql = support.hasUpdatedAt
        ? 'UPDATE journals SET text_content = ?, analysis = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        : 'UPDATE journals SET text_content = ?, analysis = ? WHERE id = ?';
      await conn.execute(updateSql, [safeText, JSON.stringify(analysis), existingRows[0].id]);
    } else if (support.hasEntryDate && support.hasUpdatedAt) {
      await conn.execute(
        'INSERT INTO journals (user_id, entry_date, text_content, analysis, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
        [userId, entryDate, safeText, JSON.stringify(analysis)]
      );
    } else if (support.hasEntryDate) {
      await conn.execute(
        'INSERT INTO journals (user_id, entry_date, text_content, analysis) VALUES (?, ?, ?, ?)',
        [userId, entryDate, safeText, JSON.stringify(analysis)]
      );
    } else {
      await conn.execute(
        'INSERT INTO journals (user_id, text_content, analysis) VALUES (?, ?, ?)',
        [userId, safeText, JSON.stringify(analysis)]
      );
    }

    const topics = safeJsonParse(JSON.stringify(baseAnalysis.topics || []), []);
    const patterns = safeJsonParse(JSON.stringify(baseAnalysis.cognitivePatterns || []), []);

    await conn.execute(
      `INSERT INTO day_profiles (user_id, date, day_of_week, journal_topics, journal_patterns, mood_avg, composite_mood, stress_avg, stress_peak, composite_stress)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         journal_topics=?,
         journal_patterns=?,
         mood_avg=COALESCE(VALUES(mood_avg), mood_avg),
         composite_mood=COALESCE(VALUES(composite_mood), composite_mood),
         stress_avg=COALESCE(VALUES(stress_avg), stress_avg),
         stress_peak=CASE
           WHEN VALUES(stress_peak) IS NULL THEN stress_peak
           WHEN stress_peak IS NULL THEN VALUES(stress_peak)
           ELSE GREATEST(stress_peak, VALUES(stress_peak))
         END,
         composite_stress=COALESCE(VALUES(composite_stress), composite_stress)`,
      [
        userId,
        entryDate,
        dow,
        JSON.stringify(topics),
        JSON.stringify(patterns),
        moodValue,
        moodValue,
        stressValue,
        stressValue,
        stressValue,
        JSON.stringify(topics),
        JSON.stringify(patterns),
      ]
    );
  });

  interventionService.recordBehaviorEvent({
    userId,
    eventType: 'journal_saved',
    eventPayload: {
      selfReportDelta: moodValue != null ? 4 - moodValue : null,
    },
  }).catch((error) => {
    console.error('[Wellbeing] Intervention journal outcome error:', error.message);
  });

  return { ok: true, analysis, journal: await getJournalEntry(userId, entryDate) };
}

async function addJournalAttachments(userId, payload) {
  await ensureWellbeingSchema();
  const entryDate = resolveJournalDate(payload?.date);
  const files = Array.isArray(payload?.files) ? payload.files.filter(Boolean) : [];

  if (files.length === 0) {
    throw createServiceError('At least one attachment is required');
  }

  await withTransaction(async (conn) => {
    const journalId = await ensureJournalRecord(conn, userId, entryDate);

    for (const file of files) {
      const detectedKind = resolveAttachmentKind(file.mimetype);
      const kind = String(file.mimetype || '').startsWith('video/')
        ? 'video'
        : normalizeJournalAttachmentKind(detectedKind, file.mimetype);
      const [insertResult] = await conn.execute(
        `INSERT INTO journal_attachments (
           journal_id, user_id, entry_date, kind, status, original_name, storage_path, mime_type, size_bytes
         ) VALUES (?, ?, ?, ?, 'processing', ?, ?, ?, ?)`,
        [
          journalId,
          userId,
          entryDate,
          kind,
          file.originalname,
          `/uploads/${file.filename}`,
          file.mimetype,
          file.size || 0,
        ]
      );

      try {
        const extracted = kind === 'video'
          ? {
              summary: `用户上传了视频《${file.originalname}》`,
              excerpt: '',
              extractedText: '',
              ocrText: '',
              memoryFacts: [],
              meta: { parser: 'video_fallback' },
            }
          : await extractAttachmentInsight(file, kind);

        await conn.execute(
          `UPDATE journal_attachments
           SET status = 'ready',
               extracted_text = ?,
               summary = ?,
               ocr_text = ?,
               memory_facts = ?,
               meta_json = ?
           WHERE id = ?`,
          [
            extracted.extractedText || null,
            extracted.summary || null,
            extracted.ocrText || null,
            JSON.stringify(extracted.memoryFacts || []),
            JSON.stringify(extracted.meta || {}),
            insertResult.insertId,
          ]
        );
      } catch (error) {
        await conn.execute(
          `UPDATE journal_attachments
           SET status = 'failed',
               summary = ?,
               meta_json = ?
           WHERE id = ?`,
          [
            `用户上传了附件《${file.originalname}》`,
            JSON.stringify({ error: error.message }),
            insertResult.insertId,
          ]
        );
      }
    }
  });

  return { ok: true, journal: await getJournalEntry(userId, entryDate) };
}

async function getTodayFeedData(userId, dateValue = null) {
  await ensureWellbeingSchema();
  const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [userId]);
  if (users.length === 0) {
    throw createServiceError('Not found', 404);
  }

  const user = users[0];
  ['challenges', 'trigs', 'perms'].forEach((field) => {
    user[field] = safeJsonParse(user[field], null);
  });

  const targetDate = normalizeFeedDate(dateValue);
  const actualTodayKey = formatDateKey(new Date());

  const [profiles] = await db.execute(
    'SELECT * FROM day_profiles WHERE user_id = ? AND date <= ? ORDER BY date DESC LIMIT 14',
    [userId, targetDate]
  );

  profiles.forEach((profile) => {
    ['chat_topics', 'chat_patterns', 'chat_emotions', 'journal_topics', 'journal_patterns'].forEach((field) => {
      profile[field] = safeJsonParse(profile[field], []);
    });
  });

  const chronologicalProfiles = [...profiles].reverse();
  const longitudinal = engine.analyzeLongitudinal(chronologicalProfiles);
  const feed = engine.buildTodayFeed(user, chronologicalProfiles, longitudinal);

  feed.voiceInsight = await getTodayVoiceInsight(userId, targetDate);
  if (targetDate === actualTodayKey) {
    await withTransaction(async (conn) => {
      await ensureCurrentMonthPaths(conn, userId, user, chronologicalProfiles, longitudinal, targetDate);
      await ensureDailyAiPathReview(conn, userId, user, chronologicalProfiles, longitudinal, targetDate);
      await ensureTodayAiSuggestion(conn, userId, feed, chronologicalProfiles, targetDate);
    });
  }

  feed.monthlyPaths = await getMonthlyRecoveryPaths(db, userId, targetDate);
  feed.practiceTodos = await getTodayPracticeTodos(db, userId, targetDate, feed.monthlyPaths);
  if (targetDate === actualTodayKey) {
    const [reviews] = await db.execute(
      `SELECT id, banner_title, banner_body, cta_label, cta_path, related_path_id, created_at
       FROM daily_ai_path_reviews
       WHERE user_id = ? AND review_date = ? AND status = 'generated'
       ORDER BY id DESC
       LIMIT 1`,
      [userId, targetDate]
    );
    feed.pathReviewBanner = reviews[0] ? {
      id: String(reviews[0].id),
      title: reviews[0].banner_title,
      body: reviews[0].banner_body,
      ctaLabel: reviews[0].cta_label,
      ctaPath: reviews[0].cta_path || (reviews[0].related_path_id ? `/path/${reviews[0].related_path_id}` : '/journey'),
      relatedPathId: reviews[0].related_path_id ? String(reviews[0].related_path_id) : null,
      createdAt: toDateTimeOrNull(reviews[0].created_at),
    } : null;
  } else {
    feed.pathReviewBanner = null;
  }
  const [earnedBadges] = await db.execute(
    'SELECT badge_id, earned_at FROM badges WHERE user_id = ? ORDER BY earned_at DESC LIMIT 8',
    [userId]
  );
  feed.badges = earnedBadges.map((badge) => ({
    badgeId: badge.badge_id,
    earnedAt: toDateTimeOrNull(badge.earned_at),
  }));

  const [journeys] = await db.execute(
    'SELECT * FROM journey_enrollments WHERE user_id = ? AND completed_at IS NULL ORDER BY started_at DESC LIMIT 1',
    [userId]
  );
  if (journeys.length > 0) feed.journeyProgress = journeys[0];

  return feed;
}

function normalizeFeedDate(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  return formatDateKey(new Date());
}

function normalizePracticeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

async function logPracticeCompletion(userId, payload) {
  const { todoId, completed, practiceId, timeSlot } = payload;
  const resolvedTodoId = typeof todoId === 'string' && todoId.trim()
    ? todoId.trim()
    : (typeof practiceId === 'string' ? practiceId.trim() : '');

  if (!resolvedTodoId) {
    throw createServiceError('todoId is required (string)');
  }

  const xpAwarded = 15;
  const today = formatDateKey(new Date());
  const shouldComplete = completed !== false;
  const [sourcePrefix, idText] = resolvedTodoId.split(':');
  const refId = Number(idText);

  if (!sourcePrefix || Number.isNaN(refId)) {
    throw createServiceError('todoId must look like "source:id"');
  }

  await withTransaction(async (conn) => {
    if (sourcePrefix === 'schedule') {
      await conn.execute(
        `UPDATE schedule_candidates
         SET todo_status = ?, todo_completed_at = ?
         WHERE user_id = ? AND id = ? AND status IN ('confirmed', 'edited')`,
        [shouldComplete ? 'completed' : 'pending', shouldComplete ? new Date() : null, userId, refId]
      );
    } else if (sourcePrefix === 'ai') {
      await conn.execute(
        `UPDATE ai_practice_suggestions
         SET status = ?, completed_at = ?
         WHERE user_id = ? AND id = ?`,
        [shouldComplete ? 'completed' : 'pending', shouldComplete ? new Date() : null, userId, refId]
      );
    } else if (sourcePrefix === 'path_task') {
      const [tasks] = await conn.execute(
        'SELECT user_path_id FROM recovery_path_tasks WHERE user_id = ? AND id = ? LIMIT 1',
        [userId, refId]
      );
      if (tasks.length === 0) throw createServiceError('Path task not found', 404);

      await conn.execute(
        `UPDATE recovery_path_tasks
         SET status = ?, completed_at = ?
         WHERE user_id = ? AND id = ?`,
        [shouldComplete ? 'completed' : 'pending', shouldComplete ? new Date() : null, userId, refId]
      );
      await syncRecoveryPathCompletion(conn, userId, tasks[0].user_path_id);
    } else {
      throw createServiceError('Unsupported todo source');
    }

    if (shouldComplete) {
      await conn.execute(
        `INSERT INTO practice_completions
          (user_id, practice_id, source_type, source_ref_id, time_slot, xp_awarded)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          resolvedTodoId,
          sourcePrefix === 'schedule' ? 'manual_schedule' : sourcePrefix === 'ai' ? 'ai_suggestion' : 'path_task',
          refId,
          timeSlot || null,
          xpAwarded,
        ]
      );
      await conn.execute('UPDATE users SET xp = xp + ? WHERE id = ?', [xpAwarded, userId]);
    }
  });

  if (shouldComplete) {
    interventionService.recordBehaviorEvent({
      userId,
      eventType: 'practice_completed',
      eventPayload: {
        practiceId: resolvedTodoId,
      },
    }).catch((error) => {
      console.error('[Wellbeing] Intervention practice outcome error:', error.message);
    });
  }

  return { ok: true, xpAwarded: shouldComplete ? xpAwarded : 0 };
}

async function getHistoryRows(userId, days) {
  const limit = validateNumberParam(days, 1, 5000, 30);
  const [rows] = await db.query(
    `SELECT * FROM day_profiles WHERE user_id = ? ORDER BY date DESC LIMIT ${limit}`,
    [userId]
  );
  return rows;
}

async function getInsightsData(userId, days) {
  const limit = validateNumberParam(days, 1, 90, 14);
  const [rows] = await db.execute(
    `SELECT * FROM day_profiles WHERE user_id = ? ORDER BY date DESC LIMIT ${limit}`,
    [userId]
  );

  rows.forEach((row) => {
    ['chat_topics', 'chat_patterns', 'journal_topics', 'journal_patterns'].forEach((field) => {
      row[field] = safeJsonParse(row[field], []);
    });
  });

  return engine.analyzeLongitudinal(rows.reverse());
}

async function saveWellnessPractices({ userId, suggestions }) {
  const saved = [];
  for (const suggestion of suggestions) {
    try {
      const result = await confirmAssistantPracticeSuggestion(userId, suggestion);
      saved.push(result);
    } catch (error) {
      console.error('[WellbeingService] Failed to save wellness practice:', error.message);
      saved.push({ ...suggestion, saved: false });
    }
  }
  return saved;
}

module.exports = {
  ensureWellbeingSchema,
  saveMoodEntry,
  saveJournalEntry,
  addJournalAttachments,
  getJournalEntry,
  getTodayFeedData,
  logPracticeCompletion,
  getHistoryRows,
  getInsightsData,
  buildPracticeSuggestionsFromAssistantReply,
  confirmAssistantPracticeSuggestion,
  saveWellnessPractices,
};
