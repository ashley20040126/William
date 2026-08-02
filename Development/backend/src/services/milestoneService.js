const db = require('../utils/db');
const { safeJsonParse } = require('./userServiceUtils');

// ── Schema ──────────────────────────────────────────────────────────────────
let schemaReady = null;

async function ensureMilestoneSchema() {
  if (!schemaReady) {
    schemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS user_milestones (
        id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id      BIGINT UNSIGNED NOT NULL,
        milestone_id VARCHAR(80) NOT NULL,
        title        VARCHAR(200) NOT NULL,
        description  TEXT,
        icon         VARCHAR(10) DEFAULT '🏅',
        earned_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_user_milestone (user_id, milestone_id),
        INDEX idx_user_milestones (user_id, earned_at DESC),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

// ── Milestone Catalogue ──────────────────────────────────────────────────────
const MILESTONE_DEFS = [
  {
    id: 'first_journal',
    title: '第一篇日记',
    description: '写下了第一篇情绪反思，迈出了自我觉察的第一步。',
    icon: '📖',
  },
  {
    id: 'stress_tracked_5',
    title: '开始系统觉察',
    description: '累计追踪了 5 天以上的情绪与压力状态。',
    icon: '📊',
  },
  {
    id: 'pattern_recognized',
    title: '发现思维模式',
    description: '在对话中识别出了至少一种认知思维模式。',
    icon: '🔍',
  },
  {
    id: 'calm_streak_3',
    title: '三天平静',
    description: '在一个周期内保持了连续三天以上的低压状态。',
    icon: '🌿',
  },
  {
    id: 'high_stress_journaled',
    title: '高压时仍然记录',
    description: '在高压期间坚持了情绪记录，而没有选择回避。',
    icon: '💪',
  },
  {
    id: 'practice_5_days',
    title: '练习成为习惯',
    description: '在一个周期内的 5 天以上完成了情绪恢复练习。',
    icon: '⚡',
  },
  {
    id: 'journal_10',
    title: '十篇日记',
    description: '累计完成了 10 篇以上的情绪反思日记。',
    icon: '🗒️',
  },
  {
    id: 'journey_enrolled',
    title: '踏上旅程',
    description: '开启了第一条系统性成长路径。',
    icon: '🚀',
  },
  {
    id: 'schedule_heavy_survived',
    title: '高密度日程下的稳定',
    description: '在高负荷日程期间保持了情绪追踪与记录。',
    icon: '📅',
  },
  {
    id: 'reflection_completed',
    title: '完成一次深度回顾',
    description: '完整完成了一次月度反思打卡。',
    icon: '✨',
  },
];

// ── Internal award helper ────────────────────────────────────────────────────
async function awardIfNeeded(userId, milestoneId) {
  const def = MILESTONE_DEFS.find((m) => m.id === milestoneId);
  if (!def) return;
  await db.execute(
    `INSERT IGNORE INTO user_milestones (user_id, milestone_id, title, description, icon)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, def.id, def.title, def.description, def.icon]
  );
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Check and award milestones from a freshly generated journey plan.
 * Called fire-and-forget after plan generation.
 *
 * @param {number} userId
 * @param {{ summary: object, profiles: object[], journals: object[] }} planData
 */
async function checkAndAwardFromPlan(userId, { summary, profiles, journals }) {
  await ensureMilestoneSchema();

  // 1. First journal
  if (journals.length >= 1) {
    await awardIfNeeded(userId, 'first_journal');
  }

  // 2. Stress tracked 5+ days (profiles in range)
  if (profiles.length >= 5) {
    await awardIfNeeded(userId, 'stress_tracked_5');
  }

  // 3. Cognitive pattern recognised in chat
  const hasPattern = profiles.some((p) => {
    const patterns = safeJsonParse(p.chat_patterns, []);
    return Array.isArray(patterns) && patterns.length > 0;
  });
  if (hasPattern) {
    await awardIfNeeded(userId, 'pattern_recognized');
  }

  // 4. Calm streak 3+ days
  if ((summary.calmDays || 0) >= 3) {
    await awardIfNeeded(userId, 'calm_streak_3');
  }

  // 5. Journalled during high stress
  if ((summary.highStressDays || 0) >= 2 && journals.length >= 1) {
    await awardIfNeeded(userId, 'high_stress_journaled');
  }

  // 6. Practice 5+ days
  const practiceDays = profiles.filter((p) => (p.practice_count || 0) > 0).length;
  if (practiceDays >= 5) {
    await awardIfNeeded(userId, 'practice_5_days');
  }

  // 7. Heavy schedule survived
  if (summary.scheduleLoad === 'high' && profiles.length >= 3) {
    await awardIfNeeded(userId, 'schedule_heavy_survived');
  }

  // 8. Cumulative journal count ≥ 10 (total lifetime, not just this range)
  try {
    const [[row]] = await db.execute(
      'SELECT COUNT(*) AS n FROM journals WHERE user_id = ?',
      [userId]
    );
    if ((row.n || 0) >= 10) {
      await awardIfNeeded(userId, 'journal_10');
    }
  } catch (_) {
    // Non-critical, swallow
  }
}

/**
 * Award the journey-enrolled milestone. Called when user enrols.
 */
async function checkJourneyMilestone(userId) {
  await ensureMilestoneSchema();
  await awardIfNeeded(userId, 'journey_enrolled');
}

/**
 * Award the reflection-completed milestone. Called when a reflection entry
 * is saved with status = 'completed'.
 */
async function checkReflectionMilestone(userId) {
  await ensureMilestoneSchema();
  await awardIfNeeded(userId, 'reflection_completed');
}

/**
 * Return all milestones earned by this user, newest first.
 */
async function getUserMilestones(userId) {
  await ensureMilestoneSchema();

  const [rows] = await db.execute(
    `SELECT milestone_id AS id, title, description, icon, earned_at
     FROM user_milestones
     WHERE user_id = ?
     ORDER BY earned_at DESC
     LIMIT 30`,
    [userId]
  );
  return rows;
}

module.exports = {
  checkAndAwardFromPlan,
  checkJourneyMilestone,
  checkReflectionMilestone,
  getUserMilestones,
};
