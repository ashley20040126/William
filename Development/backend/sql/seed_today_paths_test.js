require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function withTime(date, hour, minute = 0) {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'william',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'william_app',
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  const email = 'today-paths-test@william.local';
  const password = 'Test123456!';
  const name = 'Today Paths Tester';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayKey = formatDate(today);
  const monthStart = `${todayKey.slice(0, 7)}-01`;

  const passwordHash = await bcrypt.hash(password, 10);

  await conn.beginTransaction();

  const [existingUsers] = await conn.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  let userId;
  if (existingUsers.length > 0) {
    userId = Number(existingUsers[0].id);
    await conn.execute(
      `UPDATE users
       SET password = ?, name = ?, onboarded = 1, language = 'zh-CN', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [passwordHash, name, userId]
    );
  } else {
    const [result] = await conn.execute(
      `INSERT INTO users (email, password, name, onboarded, language)
       VALUES (?, ?, ?, 1, 'zh-CN')`,
      [email, passwordHash, name]
    );
    userId = Number(result.insertId);
  }

  await conn.execute('DELETE FROM recovery_path_tasks WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM user_recovery_paths WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM ai_practice_suggestions WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM badges WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM practice_completions WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM schedule_candidates WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM chat_messages WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM chat_sessions WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM day_profiles WHERE user_id = ?', [userId]);

  await conn.execute(
    `INSERT INTO day_profiles
      (user_id, date, day_of_week, composite_stress, composite_mood, chat_topics, journal_topics, stress_avg, stress_peak, ambient_stress_avg, practice_count, practices_done)
     VALUES
      (?, ?, 'Wednesday', 7.8, 2.4, ?, ?, 7.8, 8.6, 6.9, 0, JSON_ARRAY()),
      (?, DATE_SUB(?, INTERVAL 1 DAY), 'Tuesday', 7.1, 2.6, ?, ?, 7.1, 8.0, 6.3, 0, JSON_ARRAY())`,
    [
      userId,
      todayKey,
      JSON.stringify(['argued with a close friend', 'workload pressure']),
      JSON.stringify(['friend conflict', 'burnout']),
      userId,
      todayKey,
      JSON.stringify(['upcoming difficult conversation']),
      JSON.stringify(['relationship tension']),
    ]
  );

  const [sessionResult] = await conn.execute(
    'INSERT INTO chat_sessions (user_id, session_key) VALUES (?, ?)',
    [userId, `today_paths_seed_${Date.now()}`]
  );
  const sessionId = Number(sessionResult.insertId);

  const [messageResult] = await conn.execute(
    `INSERT INTO chat_messages (session_id, user_id, role, content)
     VALUES (?, ?, 'user', ?)`,
    [sessionId, userId, 'Tomorrow I need to repair a conflict with a friend and I am overwhelmed by work.']
  );
  const messageId = Number(messageResult.insertId);

  const scheduleStart = withTime(today, 10, 0);
  const scheduleEnd = withTime(today, 11, 0);
  await conn.execute(
    `INSERT INTO schedule_candidates
      (user_id, session_id, source_message_id, title, start_time, end_time, date_text, location, participants_json, confidence, status, dedupe_key, meta_json, todo_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, 'pending')`,
    [
      userId,
      sessionId,
      messageId,
      'Team sync you planned manually',
      scheduleStart,
      scheduleEnd,
      todayKey,
      'Office / Zoom',
      JSON.stringify(['Teammates']),
      0.98,
      `today-paths-test:${todayKey}:manual-schedule`,
      JSON.stringify({ source: 'local_test_seed' }),
    ]
  );

  await conn.execute(
    `INSERT INTO ai_practice_suggestions
      (user_id, suggestion_date, title, description, suggestion_type, trigger_label, recommended_time, action_prompt, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      userId,
      todayKey,
      'Take a 10-minute outdoor reset between work blocks',
      'William detected tension from recent conflict and work pressure. Step outside before the next demanding block.',
      'outdoor_walk',
      'friend conflict + workload pressure',
      'Between meetings',
      'Guide me through a short outdoor reset before my next meeting.',
      JSON.stringify({ source: 'local_test_seed' }),
    ]
  );

  const [completedPathResult] = await conn.execute(
    `INSERT INTO user_recovery_paths
      (user_id, template_id, month_start, title, summary, stress_source, badge_id, status, icon, gradient_json, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, CURRENT_TIMESTAMP)`,
    [
      userId,
      'conflict_reset',
      monthStart,
      'Repairing a Frayed Relationship',
      'A completed example path so the all-paths page shows finished challenges too.',
      'friend conflict',
      'badge_conflict_reset',
      '🫶',
      JSON.stringify(['#D46A6A', '#F1B28F']),
    ]
  );
  const completedPathId = Number(completedPathResult.insertId);

  await conn.execute(
    `INSERT INTO recovery_path_tasks
      (user_id, user_path_id, task_date, task_kind, title, description, action_prompt, sort_order, status, completed_at, metadata_json)
     VALUES
      (?, ?, DATE_SUB(?, INTERVAL 6 DAY), 'reflection', 'Name what still hurts', 'Completed example task.', 'Help me unpack what still hurts.', 0, 'completed', DATE_SUB(NOW(), INTERVAL 6 DAY), ?),
      (?, ?, DATE_SUB(?, INTERVAL 4 DAY), 'outreach', 'Draft one honest message', 'Completed example task.', 'Help me draft a calm reconciliation message.', 1, 'completed', DATE_SUB(NOW(), INTERVAL 4 DAY), ?),
      (?, ?, DATE_SUB(?, INTERVAL 2 DAY), 'somatic', 'Notice your body before contact', 'Completed example task.', 'Guide me through a short grounding exercise.', 2, 'completed', DATE_SUB(NOW(), INTERVAL 2 DAY), ?)`,
    [
      userId, completedPathId, todayKey, JSON.stringify({ source: 'local_test_seed' }),
      userId, completedPathId, todayKey, JSON.stringify({ source: 'local_test_seed' }),
      userId, completedPathId, todayKey, JSON.stringify({ source: 'local_test_seed' }),
    ]
  );

  await conn.execute(
    'INSERT IGNORE INTO badges (user_id, badge_id) VALUES (?, ?)',
    [userId, 'badge_conflict_reset']
  );

  const [activePathResult] = await conn.execute(
    `INSERT INTO user_recovery_paths
      (user_id, template_id, month_start, title, summary, stress_source, badge_id, status, icon, gradient_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [
      userId,
      'burnout_boundary',
      monthStart,
      'Rebuilding Boundaries Around Pressure',
      'This path is intentionally left one task away from completion so you can verify badge awarding.',
      'workload pressure',
      'badge_boundary_builder',
      '🛡️',
      JSON.stringify(['#5873B8', '#8EC5FC']),
    ]
  );
  const activePathId = Number(activePathResult.insertId);

  await conn.execute(
    `INSERT INTO recovery_path_tasks
      (user_id, user_path_id, task_date, task_kind, title, description, action_prompt, sort_order, status, completed_at, metadata_json)
     VALUES
      (?, ?, DATE_SUB(?, INTERVAL 3 DAY), 'reflection', 'Spot the loudest pressure point', 'Already completed for test setup.', 'Help me identify the main source of pressure in my day.', 0, 'completed', DATE_SUB(NOW(), INTERVAL 3 DAY), ?),
      (?, ?, DATE_SUB(?, INTERVAL 1 DAY), 'schedule', 'Protect one recovery window', 'Already completed for test setup.', 'Help me design a 15-minute recovery buffer between two stressful commitments.', 1, 'completed', DATE_SUB(NOW(), INTERVAL 1 DAY), ?),
      (?, ?, ?, 'boundary', 'Practice one kind no', 'This is today''s pending path task. Checking it should complete the path and award a badge.', 'Help me phrase a kind but clear boundary.', 2, 'pending', NULL, ?)`,
    [
      userId, activePathId, todayKey, JSON.stringify({ source: 'local_test_seed' }),
      userId, activePathId, todayKey, JSON.stringify({ source: 'local_test_seed' }),
      userId, activePathId, todayKey, JSON.stringify({ source: 'local_test_seed' }),
    ]
  );

  await conn.commit();
  await conn.end();

  console.log('[seed_today_paths_test] Done');
  console.log(`email: ${email}`);
  console.log(`password: ${password}`);
  console.log(`today: ${todayKey}`);
  console.log('Expected today todo sources: manual_schedule, ai_suggestion, path_task');
  console.log('Expected badge transition after checking the pending path task: badge_boundary_builder should appear.');
}

main().catch(async (error) => {
  console.error('[seed_today_paths_test] Failed:', error.message);
  process.exit(1);
});
