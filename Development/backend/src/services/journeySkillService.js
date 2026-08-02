const db = require('../utils/db');
const { safeJsonParse } = require('./userServiceUtils');

let schemaReady = null;

async function ensureSkillSchema() {
  if (!schemaReady) {
    schemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS user_skills (
        id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id       BIGINT UNSIGNED NOT NULL,
        practice_id   VARCHAR(64) NOT NULL,
        title         VARCHAR(200) NOT NULL,
        type          VARCHAR(40) NOT NULL,
        cadence       VARCHAR(200),
        trigger_note  TEXT,
        reason        TEXT,
        steps         JSON,
        source_range  VARCHAR(32),
        last_seen_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_user_practice (user_id, practice_id),
        INDEX idx_user_skills_seen (user_id, last_seen_at DESC),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/**
 * Upsert practices from an AI plan into the persistent user_skills table.
 * Called fire-and-forget after plan generation so it never blocks the response.
 */
async function persistSkillsFromPlan(userId, practices, from, to) {
  if (!Array.isArray(practices) || practices.length === 0) return;
  await ensureSkillSchema();

  const sourceRange = `${from}~${to}`;
  for (const p of practices) {
    if (!p.id || !p.title) continue;
    await db.execute(
      `INSERT INTO user_skills
         (user_id, practice_id, title, type, cadence, trigger_note, reason, steps, source_range)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title        = VALUES(title),
         type         = VALUES(type),
         cadence      = VALUES(cadence),
         trigger_note = VALUES(trigger_note),
         reason       = VALUES(reason),
         steps        = VALUES(steps),
         source_range = VALUES(source_range),
         last_seen_at = CURRENT_TIMESTAMP`,
      [
        userId,
        String(p.id).slice(0, 64),
        String(p.title).slice(0, 200),
        String(p.type || 'maintenance').slice(0, 40),
        p.cadence ? String(p.cadence).slice(0, 200) : null,
        p.trigger ? String(p.trigger).slice(0, 2000) : null,
        p.reason ? String(p.reason).slice(0, 2000) : null,
        JSON.stringify(Array.isArray(p.steps) ? p.steps : []),
        sourceRange,
      ]
    );
  }
}

/**
 * Return the user's accumulated skill toolkit, newest first.
 */
async function getUserSkills(userId) {
  await ensureSkillSchema();

  const [rows] = await db.execute(
    `SELECT practice_id AS id, title, type, cadence,
            trigger_note AS \`trigger\`, reason, steps, source_range, last_seen_at
     FROM user_skills
     WHERE user_id = ?
     ORDER BY last_seen_at DESC
     LIMIT 20`,
    [userId]
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    cadence: row.cadence || '',
    trigger: row.trigger || '',
    reason: row.reason || '',
    steps: safeJsonParse(row.steps, []),
    sourceRange: row.source_range || '',
    lastSeenAt: row.last_seen_at,
  }));
}

module.exports = { persistSkillsFromPlan, getUserSkills };
