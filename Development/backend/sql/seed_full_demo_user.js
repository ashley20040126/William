require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const USER_EMAIL = 'demo-all-features@william.local';
const USER_PASSWORD = 'Demo123456!';
const USER_NAME = 'Demo Explorer';
const HISTORY_DAYS = 7;

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function setTime(date, hour, minute = 0) {
  const next = new Date(date);
  next.setUTCHours(hour, minute, 0, 0);
  return next;
}

function monthStart(date) {
  return `${formatDate(date).slice(0, 7)}-01`;
}

function weekday(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function buildAmbientEventsForDay({ currentDate, dayIndex, stress, analysis, todayIndex }) {
  if (dayIndex === todayIndex) {
    return [
      {
        createdAt: setTime(currentDate, 1, 10),
        transcript: 'Morning check-in before work. Voice still calm but already a little tight.',
        tokenCount: 34,
        emotion: 'neutral',
        topic: 'morning',
        stressValue: 4.8,
        stability: 0.18,
        speechPace: 0.95,
        vocalVitality: 0.64,
      },
      {
        createdAt: setTime(currentDate, 6, 2),
        transcript: 'Meeting pressure spiked after another urgent request landed.',
        tokenCount: 49,
        emotion: 'anxiety',
        topic: 'meeting',
        stressValue: 7.9,
        stability: 0.12,
        speechPace: 1.14,
        vocalVitality: 0.41,
      },
      {
        createdAt: setTime(currentDate, 8, 6),
        transcript: 'Another conversation in the hallway brought the same pressure back.',
        tokenCount: 46,
        emotion: 'anxiety',
        topic: 'meeting',
        stressValue: 8.2,
        stability: 0.1,
        speechPace: 1.18,
        vocalVitality: 0.38,
      },
    ];
  }

  if (dayIndex === todayIndex - 1) {
    return [
      {
        createdAt: setTime(currentDate, 3, 10),
        transcript: 'Yesterday voice sample one. Tension was present but more stable overall.',
        tokenCount: 38,
        emotion: analysis.dominantEmotion,
        topic: 'work',
        stressValue: Math.max(3.8, stress - 0.8),
        stability: 0.82,
        speechPace: 0.98,
        vocalVitality: 0.66,
      },
      {
        createdAt: setTime(currentDate, 7, 40),
        transcript: 'Yesterday voice sample two. Recovery held better between conversations.',
        tokenCount: 36,
        emotion: 'neutral',
        topic: 'recovery',
        stressValue: Math.max(3.6, stress - 1.1),
        stability: 0.78,
        speechPace: 0.96,
        vocalVitality: 0.68,
      },
    ];
  }

  return [
    {
      createdAt: setTime(currentDate, 18, 20),
      transcript: `Ambient day ${dayIndex + 1}: voice tension around ${analysis.topics[0] || 'pressure'}.`,
      tokenCount: 28 + dayIndex,
      emotion: analysis.dominantEmotion,
      topic: analysis.topics[0] || 'pressure',
      stressValue: Math.max(2.8, Math.round((stress + 0.2) * 10) / 10),
      stability: 0.62,
      speechPace: 1,
      vocalVitality: 0.58,
    },
  ];
}

function buildJournal(theme, stress, mood, dayIndex) {
  const themeBody = {
    work: '工作上的推进和交付还在持续压着我',
    conflict: '和朋友之间那次争吵还在我心里反复重播',
    breakup: '分手之后那种失重感还没有真的过去',
    recovery: '我开始意识到自己不是需要更努力，而是需要恢复',
    focus: '注意力今天依然很容易被切碎',
    selfTrust: '我有一点不相信自己能不能把说过的话做到',
    family: '和家人的沟通会让我一下子变得很紧绷',
  }[theme] || '今天有几件事都在拉扯我的能量';

  const tone = stress >= 7
    ? '我能感觉到身体一直绷着，像是没有真正停下来过。'
    : stress >= 5
      ? '白天还能撑住，但心里一直有一根线没松开。'
      : '今天比前几天稳一些，至少我还有一点余裕去感受自己。';

  const moodLine = mood <= 1
    ? '也有几个瞬间我觉得自己是在慢慢回来。'
    : mood >= 3
      ? '我对很多事情都提不起真正的兴趣。'
      : '情绪整体偏中性，但还是有点钝。';

  return `Day ${dayIndex + 1}。${themeBody}。${tone}${moodLine} 我想继续观察哪些关系、安排和自我要求最容易把我再次拉回旧模式。`;
}

function buildAnalysis(theme, stress, mood) {
  const dominantEmotion = mood <= 1 ? 'hope' : mood >= 3 ? 'sadness' : stress >= 7 ? 'anxiety' : 'neutral';
  const patterns = [];
  if (stress >= 7) patterns.push('rumination');
  if (theme === 'conflict') patterns.push('self-blame');
  if (theme === 'work' || theme === 'focus') patterns.push('all-or-nothing');
  if (theme === 'selfTrust') patterns.push('catastrophizing');
  return {
    sentimentScore: mood <= 1 ? 1.4 : mood >= 3 ? -1.3 : 0.1,
    dominantEmotion,
    stressEstimate: stress,
    topics: [theme, stress >= 7 ? 'pressure' : 'recovery'],
    cognitivePatterns: patterns,
    wordCount: 56,
    hasCrisisSignal: false,
    mood,
    stress,
  };
}

async function clearExistingUserData(conn, userId) {
  await conn.execute('DELETE FROM daily_ai_path_reviews WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM recovery_path_tasks WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM user_recovery_paths WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM ai_practice_suggestions WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM daily_stories WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM pattern_milestones WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM journey_reflection_entries WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM outreach WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM schedule_candidates WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM practice_completions WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM journey_enrollments WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM badges WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM ambient_listening_events WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM day_profiles WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM journals WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM moods WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM user_memories WHERE user_id = ?', [userId]);

  const [sessions] = await conn.execute('SELECT id FROM chat_sessions WHERE user_id = ?', [userId]);
  for (const session of sessions) {
    await conn.execute('DELETE FROM session_memories WHERE session_id = ?', [session.id]);
    await conn.execute('DELETE FROM memory_events WHERE session_id = ?', [session.id]);
  }
  await conn.execute('DELETE FROM chat_sessions WHERE user_id = ?', [userId]);
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

  const random = mulberry32(20260325);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const startDate = addDays(today, -(HISTORY_DAYS - 1));
  const currentMonthStart = monthStart(today);
  const passwordHash = await bcrypt.hash(USER_PASSWORD, 10);

  try {
    await conn.beginTransaction();

    const [existingUsers] = await conn.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [USER_EMAIL]);
    let userId;
    if (existingUsers[0]) {
      userId = Number(existingUsers[0].id);
      await clearExistingUserData(conn, userId);
      await conn.execute(
        `UPDATE users
         SET password = ?, name = ?, age = ?, bio = ?, challenges = ?, sleep = ?, work = ?, trigs = ?, voice_mode = ?, language = ?,
             archetype = ?, xp = ?, streak = ?, days_used = ?, onboarded = 1, avatar_color = ?, active_path = NULL, path_step = 0,
             created_at = ?, updated_at = CURRENT_TIMESTAMP, last_active = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          passwordHash,
          USER_NAME,
          28,
          'A fully-seeded demo account for validating Today, Chat, Journal, Paths, Badges, Story, and weekly wellbeing flows.',
          JSON.stringify([2, 4, 7]),
          2,
          3,
          JSON.stringify(['deadline', 'conflict', 'breakup']),
          'classic',
          'zh-CN',
          'reflector',
          1180,
          1,
          HISTORY_DAYS,
          '#C4527A',
          formatDateTime(setTime(startDate, 9)),
          userId,
        ]
      );
    } else {
      const [result] = await conn.execute(
        `INSERT INTO users
          (email, password, name, age, bio, challenges, sleep, work, trigs, voice_mode, language, archetype, xp, streak, days_used, onboarded, avatar_color, created_at, updated_at, last_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          USER_EMAIL,
          passwordHash,
          USER_NAME,
          28,
          'A fully-seeded demo account for validating Today, Chat, Journal, Paths, Badges, Story, and weekly wellbeing flows.',
          JSON.stringify([2, 4, 7]),
          2,
          3,
          JSON.stringify(['deadline', 'conflict', 'breakup']),
          'classic',
          'zh-CN',
          'reflector',
          1180,
          1,
          HISTORY_DAYS,
          '#C4527A',
          formatDateTime(setTime(startDate, 9)),
        ]
      );
      userId = Number(result.insertId);
    }

    const [sessionMain] = await conn.execute(
      'INSERT INTO chat_sessions (user_id, session_key, created_at) VALUES (?, ?, ?)',
      [userId, 'demo_full_main', formatDateTime(setTime(addDays(today, -18), 20))]
    );
    const mainSessionId = Number(sessionMain.insertId);

    const [sessionVoice] = await conn.execute(
      'INSERT INTO chat_sessions (user_id, session_key, created_at) VALUES (?, ?, ?)',
      [userId, 'demo_full_voice', formatDateTime(setTime(addDays(today, -7), 8))]
    );
    const voiceSessionId = Number(sessionVoice.insertId);

    const themes = ['work', 'focus', 'conflict', 'recovery', 'selfTrust', 'breakup', 'family'];
    const seededUserMessages = [];

    for (let dayIndex = 0; dayIndex < HISTORY_DAYS; dayIndex += 1) {
      const currentDate = addDays(startDate, dayIndex);
      const dateKey = formatDate(currentDate);
      const theme = themes[dayIndex % themes.length];
      const stress = Math.max(3, Math.min(9, Math.round((5.3 + Math.sin(dayIndex / 3.2) * 1.3 + (theme === 'work' ? 1.3 : 0) + (theme === 'conflict' ? 1 : 0) + (random() - 0.5)) * 10) / 10));
      const mood = Math.max(0, Math.min(4, Math.round((stress >= 7 ? 3.1 : stress >= 5 ? 2.3 : 1.4) + (random() - 0.5) * 0.7)));
      const journal = buildJournal(theme, stress, mood, dayIndex);
      const analysis = buildAnalysis(theme, stress, mood);
      const ambientStress = dayIndex === HISTORY_DAYS - 1
        ? 7.6
        : Math.max(2, Math.min(9, Math.round((stress + (random() - 0.5) * 1.2) * 10) / 10));
      const practiceIds = [];
      if (dayIndex % 2 === 0) practiceIds.push('breathing_reset');
      if (dayIndex % 5 === 0) practiceIds.push('weekly_reflection');

      await conn.execute(
        `INSERT INTO moods (user_id, mood, stress, note, note_analysis, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          mood,
          Math.round(stress),
          journal.slice(0, 160),
          JSON.stringify(analysis),
          formatDateTime(setTime(currentDate, 12)),
        ]
      );

      await conn.execute(
        `INSERT INTO journals (user_id, entry_date, text_content, analysis, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          dateKey,
          journal,
          JSON.stringify(analysis),
          formatDateTime(setTime(currentDate, 21, 30)),
          formatDateTime(setTime(currentDate, 21, 35)),
        ]
      );

      await conn.execute(
        `INSERT INTO day_profiles (
           user_id, date, day_of_week, composite_stress, composite_mood, chat_stress, chat_peak,
           ambient_stress_avg, ambient_stress_peak, ambient_listening_count, ambient_transcript_tokens,
           chat_emotions, chat_topics, chat_patterns, chat_engagement, chat_count,
           mood_avg, stress_avg, stress_peak, journal_topics, journal_patterns,
           practice_count, practices_done, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          dateKey,
          weekday(currentDate),
          stress,
          4 - mood,
          stress,
          Math.min(10, stress + 0.8),
          ambientStress,
          Math.min(10, ambientStress + 0.7),
          dayIndex % 3 === 0 ? 2 : 1,
          150 + Math.round(random() * 140),
          JSON.stringify([analysis.dominantEmotion]),
          JSON.stringify([theme, stress >= 7 ? 'pressure' : 'recovery']),
          JSON.stringify(analysis.cognitivePatterns),
          180 + Math.round(random() * 120),
          dayIndex % 4 === 0 ? 3 : 2,
          4 - mood,
          stress,
          Math.min(10, stress + 0.5),
          JSON.stringify([theme, mood >= 3 ? 'fatigue' : 'recovery']),
          JSON.stringify(analysis.cognitivePatterns),
          practiceIds.length,
          JSON.stringify(practiceIds),
          formatDateTime(setTime(currentDate, 23, 10)),
        ]
      );

      const ambientEvents = buildAmbientEventsForDay({
        currentDate,
        dayIndex,
        stress,
        analysis,
        todayIndex: HISTORY_DAYS - 1,
      });
      for (const ambientEvent of ambientEvents) {
        await conn.execute(
          `INSERT INTO ambient_listening_events
            (user_id, transcript, transcript_hash, token_count, analysis_json, source_page, source_session_key, created_at)
           VALUES (?, ?, SHA1(?), ?, ?, 'today', ?, ?)`,
          [
            userId,
            ambientEvent.transcript,
            `ambient-${userId}-${dateKey}-${theme}-${ambientEvent.createdAt.toISOString()}`,
            ambientEvent.tokenCount,
            JSON.stringify({
              emotion: ambientEvent.emotion,
              stress: ambientEvent.stressValue,
              patterns: analysis.cognitivePatterns,
              topics: [ambientEvent.topic],
              tokenCount: ambientEvent.tokenCount,
              stability: ambientEvent.stability,
              speechPace: ambientEvent.speechPace,
              vocalVitality: ambientEvent.vocalVitality,
            }),
            'demo_ambient',
            formatDateTime(ambientEvent.createdAt),
          ]
        );
      }

      for (const practiceId of practiceIds) {
        await conn.execute(
          `INSERT INTO practice_completions (user_id, practice_id, source_type, source_ref_id, time_slot, xp_awarded, completed_at)
           VALUES (?, ?, 'ai_suggestion', NULL, ?, 15, ?)`,
          [
            userId,
            practiceId,
            practiceId === 'weekly_reflection' ? 'evening' : 'midday',
            formatDateTime(setTime(currentDate, practiceId === 'weekly_reflection' ? 20 : 14)),
          ]
        );
      }

      if (dayIndex % 2 === 0 || dayIndex >= 17) {
        const userMessage = {
          work: '今天又被 deadline 推着走，我感觉自己没有恢复窗口。',
          focus: '我现在注意力很碎，像是什么都在抓但没有真正完成。',
          conflict: '我还在想那次和朋友的争吵，不知道要不要先发消息。',
          recovery: '今天稍微好一点，我开始意识到恢复也需要被排进日程。',
          selfTrust: '我又有点觉得自己说过的话做不到，挺失望的。',
          breakup: '分手之后还是会突然一下很空，我不知道怎么慢慢回来。',
          family: '家里的消息一来我就会绷住，脑子里很快进入警戒状态。',
        }[theme];
        const assistantMessage = '先不要同时解决所有事。把今天最重的一件事挑出来，再留一个很短但明确的恢复动作。';
        const [userMessageResult] = await conn.execute(
          `INSERT INTO chat_messages (session_id, user_id, role, content, attachments, analysis, created_at)
           VALUES (?, ?, 'user', ?, ?, ?, ?)`,
          [
            dayIndex >= 14 ? voiceSessionId : mainSessionId,
            userId,
            userMessage,
            JSON.stringify([]),
            JSON.stringify(analysis),
            formatDateTime(setTime(currentDate, dayIndex >= 14 ? 8 : 19, 10)),
          ]
        );
        seededUserMessages.push({
          id: Number(userMessageResult.insertId),
          sessionId: dayIndex >= 14 ? voiceSessionId : mainSessionId,
          date: currentDate,
          theme,
        });
        await conn.execute(
          `INSERT INTO chat_messages (session_id, user_id, role, content, attachments, analysis, created_at)
           VALUES (?, ?, 'assistant', ?, ?, NULL, ?)`,
          [
            dayIndex >= 14 ? voiceSessionId : mainSessionId,
            userId,
            assistantMessage,
            JSON.stringify([]),
            formatDateTime(setTime(currentDate, dayIndex >= 14 ? 8 : 19, 12)),
          ]
        );
      }
    }

    const confirmedMessage = seededUserMessages.find((message) => message.theme === 'work') || seededUserMessages[0];
    const candidateMessage = seededUserMessages.find((message) => message.theme === 'conflict') || confirmedMessage;
    const futureMessage = seededUserMessages.find((message) => message.theme === 'recovery') || confirmedMessage;

    await conn.execute(
      `INSERT INTO schedule_candidates
        (user_id, session_id, source_message_id, title, start_time, end_time, date_text, location, participants_json, confidence, status, dedupe_key, meta_json, todo_status, created_at, updated_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.96, 'confirmed', ?, ?, 'pending', ?, ?, ?)`,
      [
        userId,
        confirmedMessage.sessionId,
        confirmedMessage.id,
        '健身',
        formatDateTime(setTime(today, 16, 30)),
        formatDateTime(setTime(today, 17, 30)),
        formatDate(today),
        'Gym studio',
        JSON.stringify([]),
        `demo-confirmed-${formatDate(today)}`,
        JSON.stringify({ seeded: true, source: 'full_demo_user' }),
        formatDateTime(setTime(addDays(today, -1), 17)),
        formatDateTime(setTime(addDays(today, -1), 17)),
        formatDateTime(setTime(addDays(today, -1), 17)),
      ]
    );

    await conn.execute(
      `INSERT INTO schedule_candidates
        (user_id, session_id, source_message_id, title, start_time, end_time, date_text, location, participants_json, confidence, status, dedupe_key, meta_json, todo_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.89, 'candidate', ?, ?, 'pending', ?, ?)`,
      [
        userId,
        candidateMessage.sessionId,
        candidateMessage.id,
        'Send a repair coffee invite',
        formatDateTime(setTime(addDays(today, 1), 18, 30)),
        formatDateTime(setTime(addDays(today, 1), 19, 15)),
        formatDate(addDays(today, 1)),
        'Neighborhood cafe',
        JSON.stringify(['Friend']),
        `demo-candidate-${formatDate(addDays(today, 1))}`,
        JSON.stringify({ seeded: true, source: 'full_demo_user' }),
        formatDateTime(setTime(today, 9, 20)),
        formatDateTime(setTime(today, 9, 20)),
      ]
    );

    await conn.execute(
      `INSERT INTO schedule_candidates
        (user_id, session_id, source_message_id, title, start_time, end_time, date_text, location, participants_json, confidence, status, dedupe_key, meta_json, todo_status, created_at, updated_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.93, 'confirmed', ?, ?, 'completed', ?, ?, ?)`,
      [
        userId,
        futureMessage.sessionId,
        futureMessage.id,
        'Long reset walk',
        formatDateTime(setTime(addDays(today, -2), 8)),
        formatDateTime(setTime(addDays(today, -2), 9)),
        formatDate(addDays(today, -2)),
        'River park',
        JSON.stringify([]),
        `demo-walk-${formatDate(addDays(today, -2))}`,
        JSON.stringify({ seeded: true, source: 'full_demo_user' }),
        formatDateTime(setTime(addDays(today, -3), 18)),
        formatDateTime(setTime(addDays(today, -3), 18)),
        formatDateTime(setTime(addDays(today, -3), 18)),
      ]
    );

    await conn.execute(
      `INSERT INTO ai_practice_suggestions
        (user_id, suggestion_date, title, description, suggestion_type, trigger_label, recommended_time, action_prompt, status, metadata_json, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, 'nervous_system_reset', ?, 'Midday', ?, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        (?, ?, ?, ?, 'outdoor_walk', ?, 'Between meetings', ?, 'completed', ?, ?, ?)`,
      [
        userId,
        formatDate(today),
        '5分钟呼吸练习',
        '帮助你从今天的高压时段恢复。',
        'deadline + breakup aftershock',
        '带我做一个 5 分钟的呼吸恢复练习。',
        JSON.stringify({ seeded: true, source: 'full_demo_user' }),
        userId,
        formatDate(addDays(today, -1)),
        'Take a short outdoor reset before you reply',
        'Step outside for 10 minutes before sending any emotionally loaded reply.',
        'friend conflict',
        'Help me use a short outdoor walk to reset before replying.',
        JSON.stringify({ seeded: true, source: 'full_demo_user' }),
        formatDateTime(setTime(addDays(today, -1), 13)),
        formatDateTime(setTime(addDays(today, -1), 13)),
      ]
    );

    await conn.execute(
      `INSERT INTO journey_enrollments (user_id, journey_id, current_step, started_at, completed_at)
       VALUES (?, 'stability', 4, ?, NULL)`,
      [userId, formatDateTime(addDays(today, -16))]
    );

    const [completedPathResult] = await conn.execute(
      `INSERT INTO user_recovery_paths
        (user_id, template_id, month_start, title, summary, stress_source, badge_id, generation_source, status, icon, gradient_json, completed_at, created_at, updated_at)
       VALUES (?, 'conflict_reset', ?, ?, ?, ?, 'badge_conflict_reset', 'monthly_planner', 'completed', '🫶', ?, ?, ?, ?)`,
      [
        userId,
        currentMonthStart,
        'Repairing a Frayed Relationship',
        'A completed relationship-repair path so the paths page shows both completed and active journeys.',
        'friend conflict',
        JSON.stringify(['#D46A6A', '#F1B28F']),
        formatDateTime(addDays(today, -6)),
        formatDateTime(addDays(today, -17)),
        formatDateTime(addDays(today, -6)),
      ]
    );
    const completedPathId = Number(completedPathResult.insertId);

    const [activeBoundaryResult] = await conn.execute(
      `INSERT INTO user_recovery_paths
        (user_id, template_id, month_start, title, summary, stress_source, badge_id, generation_source, status, icon, gradient_json, created_at, updated_at)
       VALUES (?, 'burnout_boundary', ?, ?, ?, ?, 'badge_boundary_builder', 'monthly_planner', 'active', '🛡️', ?, ?, ?)`,
      [
        userId,
        currentMonthStart,
        '围绕压力重建边界',
        '从压力模式出发，把边界感拆成一个月里每天都能完成的小动作。',
        'workload pressure',
        JSON.stringify(['#5873B8', '#8EC5FC']),
        formatDateTime(addDays(today, -10)),
        formatDateTime(addDays(today, -1)),
      ]
    );
    const activeBoundaryPathId = Number(activeBoundaryResult.insertId);

    const [activeTrustResult] = await conn.execute(
      `INSERT INTO user_recovery_paths
        (user_id, template_id, month_start, title, summary, stress_source, badge_id, generation_source, status, icon, gradient_json, created_at, updated_at)
       VALUES (?, 'self_trust', ?, ?, ?, ?, 'badge_self_trust', 'monthly_planner', 'active', '🧭', ?, ?, ?)`,
      [
        userId,
        currentMonthStart,
        'Rebuilding Self-Trust Under Stress',
        'An ongoing self-trust path with the next task still ahead later this week.',
        'self-trust strain',
        JSON.stringify(['#7B61C9', '#D6A6FF']),
        formatDateTime(addDays(today, -5)),
        formatDateTime(addDays(today, -1)),
      ]
    );
    const activeTrustPathId = Number(activeTrustResult.insertId);

    const [reviewPathResult] = await conn.execute(
      `INSERT INTO user_recovery_paths
        (user_id, template_id, month_start, title, summary, stress_source, badge_id, generation_source, review_reason, status, icon, gradient_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'badge_gentle_return', 'daily_ai_review', ?, 'active', '🌱', ?, ?, ?)`,
      [
        userId,
        `grief_stabilizer_review_${formatDate(today).replace(/-/g, '')}`.slice(0, 40),
        currentMonthStart,
        'Gentle Return After a Major Loss',
        'Generated from the overnight AI review because recent chats, journals, and low follow-through suggested a need for steadier grief recovery support.',
        'breakup aftershock',
        'grief_stabilizer | stress=7.2 | completions=1 | matched signals: breakup, loss',
        JSON.stringify(['#4C7D6B', '#9ED9C5']),
        formatDateTime(setTime(today, 0, 2)),
        formatDateTime(setTime(today, 0, 2)),
      ]
    );
    const reviewPathId = Number(reviewPathResult.insertId);

    await conn.execute(
      `INSERT INTO recovery_path_tasks
        (user_id, user_path_id, task_date, task_kind, title, description, action_prompt, sort_order, status, completed_at, metadata_json, created_at, updated_at)
       VALUES
        (?, ?, ?, 'journal', 'Name what still hurts', 'Completed task for the finished relationship-repair path.', 'Help me unpack the conflict that is still replaying in my mind.', 0, 'completed', ?, ?, ?, ?),
        (?, ?, ?, 'outreach', 'Draft one honest message', 'Completed task for the finished relationship-repair path.', 'Help me draft a calm reconciliation message.', 1, 'completed', ?, ?, ?, ?),
        (?, ?, ?, 'somatic', 'Notice your body before contact', 'Completed task for the finished relationship-repair path.', 'Guide me through a short grounding exercise before I reach out.', 2, 'completed', ?, ?, ?, ?),

        (?, ?, ?, 'reflection', '看见今天最吵的压力源', '本周早些时候已完成。', '帮我找出今天最主要的压力来源。', 0, 'completed', ?, ?, ?, ?),
        (?, ?, ?, 'schedule', '保护一个恢复时间窗', '本周早些时候已完成。', '帮我在两个高压安排之间留出 15 分钟恢复缓冲。', 1, 'completed', ?, ?, ?, ?),
        (?, ?, ?, 'boundary', '写一条“我今天守住了”的记录', '来自你的边界重建路径。完成它会结束这条路径并发放徽章。', '帮我写下一条“我今天守住了”的记录，并把它说得具体一点。', 2, 'pending', NULL, ?, ?, ?),

        (?, ?, ?, 'commitment', 'Pick one promise you can keep', 'Completed earlier in the week.', 'Help me pick one small promise I can keep today.', 0, 'completed', ?, ?, ?, ?),
        (?, ?, ?, 'ai_dialogue', 'Complete one guided check-in', 'The next step is still pending later this week.', 'I want a deeper check-in about what keeps breaking my self-trust.', 1, 'pending', NULL, ?, ?, ?),
        (?, ?, ?, 'reflection', 'Record evidence of follow-through', 'Scheduled for later this week.', 'Help me reflect on one small promise I kept.', 2, 'pending', NULL, ?, ?, ?),

        (?, ?, ?, 'reflection', 'Make room for the loss', 'This new AI-generated path starts with a gentle reflective task today.', 'Stay with me while I talk through a recent loss.', 0, 'pending', NULL, ?, ?, ?),
        (?, ?, ?, 'somatic', 'Do one grounding action', 'A grounding task for tomorrow.', 'Guide me through a gentle grounding reset.', 1, 'pending', NULL, ?, ?, ?),
        (?, ?, ?, 'outreach', 'Reconnect with one safe person', 'Later in the week, reconnect with someone emotionally safe.', 'Help me write a simple message asking for connection.', 2, 'pending', NULL, ?, ?, ?)`,
      [
        userId, completedPathId, formatDate(addDays(today, -15)), formatDateTime(addDays(today, -15)), JSON.stringify({ seeded: true }), formatDateTime(addDays(today, -15)), formatDateTime(addDays(today, -15)),
        userId, completedPathId, formatDate(addDays(today, -13)), formatDateTime(addDays(today, -13)), JSON.stringify({ seeded: true }), formatDateTime(addDays(today, -13)), formatDateTime(addDays(today, -13)),
        userId, completedPathId, formatDate(addDays(today, -10)), formatDateTime(addDays(today, -10)), JSON.stringify({ seeded: true }), formatDateTime(addDays(today, -10)), formatDateTime(addDays(today, -10)),

        userId, activeBoundaryPathId, formatDate(addDays(today, -4)), formatDateTime(addDays(today, -4)), JSON.stringify({ seeded: true }), formatDateTime(addDays(today, -4)), formatDateTime(addDays(today, -4)),
        userId, activeBoundaryPathId, formatDate(addDays(today, -2)), formatDateTime(addDays(today, -2)), JSON.stringify({ seeded: true }), formatDateTime(addDays(today, -2)), formatDateTime(addDays(today, -2)),
        userId, activeBoundaryPathId, formatDate(today), JSON.stringify({ seeded: true, source: 'today_path_task' }), formatDateTime(today), formatDateTime(today),

        userId, activeTrustPathId, formatDate(addDays(today, -3)), formatDateTime(addDays(today, -3)), JSON.stringify({ seeded: true }), formatDateTime(addDays(today, -3)), formatDateTime(addDays(today, -3)),
        userId, activeTrustPathId, formatDate(addDays(today, 2)), JSON.stringify({ seeded: true }), formatDateTime(today), formatDateTime(today),
        userId, activeTrustPathId, formatDate(addDays(today, 5)), JSON.stringify({ seeded: true }), formatDateTime(today), formatDateTime(today),

        userId, reviewPathId, formatDate(today), JSON.stringify({ seeded: true, origin: 'daily_ai_review' }), formatDateTime(setTime(today, 0, 2)), formatDateTime(setTime(today, 0, 2)),
        userId, reviewPathId, formatDate(addDays(today, 1)), JSON.stringify({ seeded: true, origin: 'daily_ai_review' }), formatDateTime(setTime(today, 0, 2)), formatDateTime(setTime(today, 0, 2)),
        userId, reviewPathId, formatDate(addDays(today, 4)), JSON.stringify({ seeded: true, origin: 'daily_ai_review' }), formatDateTime(setTime(today, 0, 2)), formatDateTime(setTime(today, 0, 2)),
      ]
    );

    const extraBoundaryTasks = [
      { offset: -14, kind: 'reflection', title: '回看一个让我消耗过头的下午', description: '把那个你明明快耗尽还继续顶着的下午写下来。', prompt: '帮我回看一个让我消耗过头的下午。', status: 'completed' },
      { offset: -13, kind: 'journal', title: '写下我为什么总想先答应', description: '看见自己过度承担背后的害怕和惯性。', prompt: '帮我写下我为什么总想先答应别人的需求。', status: 'completed' },
      { offset: -12, kind: 'reflection', title: '记下一个最容易妥协的时刻', description: '回看最近一次你明明很累却还是答应下来的时刻。', prompt: '帮我回看一次我不想答应却还是答应了的时刻。', status: 'completed' },
      { offset: -11, kind: 'boundary', title: '写下一个边界句型', description: '把“我现在做不到”写成一句温和但明确的话。', prompt: '帮我写一句温和但明确的边界表达。', status: 'completed' },
      { offset: -10, kind: 'somatic', title: '做一次肩颈放松', description: '用身体提醒自己，紧绷不是唯一选项。', prompt: '带我做一个 2 分钟的肩颈放松。', status: 'completed' },
      { offset: -9, kind: 'reflection', title: '分清请求和责任', description: '把别人提出的需求和真正属于你的责任分开。', prompt: '帮我分清哪些是请求，哪些才是我的责任。', status: 'completed' },
      { offset: -8, kind: 'journal', title: '记录一次没有立刻回复', description: '记下你给自己争取了几分钟空间的那一次。', prompt: '帮我记录一次我没有立刻回复、而是先停下来的经历。', status: 'completed' },
      { offset: -7, kind: 'schedule', title: '给自己留一个空档', description: '在日程里留出一段不被工作吞掉的恢复时间。', prompt: '帮我把一个恢复空档安排进今天。', status: 'completed' },
      { offset: -6, kind: 'boundary', title: '练习一句延后回复', description: '把“我晚点给你答复”练到自然。', prompt: '帮我练一句“我晚点给你答复”。', status: 'completed' },
      { offset: -5, kind: 'reflection', title: '看见身体先紧的瞬间', description: '找出压力来时，身体最先发出的那个信号。', prompt: '帮我识别压力来时身体最先变紧的地方。', status: 'completed' },
      { offset: -3, kind: 'commitment', title: '守住今天最小的边界', description: '选一个最容易做到的小边界，先把它守住。', prompt: '帮我挑一个今天最容易守住的小边界。', status: 'completed' },
      { offset: -1, kind: 'ai_dialogue', title: '复盘一次高压对话', description: '把昨天最有压迫感的那次对话拆开看看。', prompt: '帮我复盘昨天那次让我压力上升的对话。', status: 'completed' },
      { offset: 1, kind: 'boundary', title: '准备一句礼貌拒绝', description: '给明天可能出现的额外需求提前准备一句边界话术。', prompt: '帮我准备一句礼貌拒绝额外需求的话。', status: 'pending' },
      { offset: 2, kind: 'reflection', title: '记录一次没有过度解释', description: '看见你说“不”时有没有少一点自我辩护。', prompt: '帮我记录一次我说不时没有过度解释的时刻。', status: 'pending' },
      { offset: 3, kind: 'schedule', title: '给午后留一块恢复区', description: '在最容易被会议吞掉的时段前后留出恢复空白。', prompt: '帮我安排一个午后恢复区。', status: 'pending' },
      { offset: 4, kind: 'journal', title: '写下边界后的身体感受', description: '把“说出来以后”的身体感觉写下来。', prompt: '帮我写下设边界之后身体发生了什么变化。', status: 'pending' },
      { offset: 5, kind: 'somatic', title: '做一次呼气更长的练习', description: '通过更长的呼气把系统从警戒里慢慢带出来。', prompt: '带我做一个呼气更长的放松练习。', status: 'pending' },
      { offset: 6, kind: 'reflection', title: '看见谁最容易越界', description: '找出最常把你推回旧模式的人或情境。', prompt: '帮我看见谁最容易让我失守边界。', status: 'pending' },
      { offset: 7, kind: 'boundary', title: '练习一次更短的回应', description: '不用解释很多，也能表达清楚。', prompt: '帮我把一段边界表达缩短到更自然。', status: 'pending' },
      { offset: 8, kind: 'commitment', title: '守住一个下班截止线', description: '给工作设一个结束时间，并尽量按它收尾。', prompt: '帮我为今晚设一个工作截止线。', status: 'pending' },
      { offset: 9, kind: 'ai_dialogue', title: '排练一次边界对话', description: '先在 William 里练，再带去真实关系里。', prompt: '陪我排练一次边界对话。', status: 'pending' },
      { offset: 10, kind: 'reflection', title: '记录一次及时停下', description: '注意到自己没有继续硬撑的那一个瞬间。', prompt: '帮我记录一次我及时停下来的时刻。', status: 'pending' },
      { offset: 11, kind: 'journal', title: '写给更稳的自己一句话', description: '给未来那个更稳的自己留一句提醒。', prompt: '帮我写一句话给更稳的自己。', status: 'pending' },
      { offset: 12, kind: 'boundary', title: '回看最有效的一句边界话', description: '找到这个月最有用的那句表达。', prompt: '帮我回看这个月最有效的一句边界表达。', status: 'pending' },
      { offset: 13, kind: 'reflection', title: '总结本月的守住时刻', description: '把那些你没有再轻易退回旧模式的时刻串起来。', prompt: '帮我总结这个月我守住边界的几个时刻。', status: 'pending' },
      { offset: 14, kind: 'commitment', title: '为下个月立一个边界承诺', description: '把这条路径收束成一个下个月也能延续的小承诺。', prompt: '帮我为下个月立一个边界承诺。', status: 'pending' },
      { offset: 15, kind: 'reflection', title: '写下边界带来的新余裕', description: '看看这个月多出来的那一点点空间，想留给什么。', prompt: '帮我写下边界带来的新余裕。', status: 'pending' },
    ];

    for (let index = 0; index < extraBoundaryTasks.length; index += 1) {
      const task = extraBoundaryTasks[index];
      const taskDate = addDays(today, task.offset);
      await conn.execute(
        `INSERT INTO recovery_path_tasks
          (user_id, user_path_id, task_date, task_kind, title, description, action_prompt, sort_order, status, completed_at, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          activeBoundaryPathId,
          formatDate(taskDate),
          task.kind,
          task.title,
          task.description,
          task.prompt,
          10 + index,
          task.status,
          task.status === 'completed' ? formatDateTime(setTime(taskDate, 21, 0)) : null,
          JSON.stringify({ seeded: true, source: 'full_demo_boundary_month' }),
          formatDateTime(setTime(taskDate, 8, 0)),
          formatDateTime(setTime(taskDate, 8, 0)),
        ]
      );
    }

    await conn.execute(
      `INSERT INTO daily_ai_path_reviews
        (user_id, review_date, status, review_summary, signals_json, generated_path_count, banner_title, banner_body, cta_label, cta_path, related_path_id, created_at, updated_at)
       VALUES (?, ?, 'generated', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        formatDate(today),
        'Daily AI review generated 1 path based on breakup language, elevated stress, and thin recent follow-through.',
        JSON.stringify({
          averageStress: 7.2,
          completionCount: 1,
          topTrigger: 'breakup aftershock',
          userMessageCount: seededUserMessages.length,
          journalCount: HISTORY_DAYS,
        }),
        'William created a new recovery path for you',
        'After reviewing your chats, journal, and recent follow-through, William added "Gentle Return After a Major Loss" to support breakup aftershock.',
        'Open new path',
        `/path/${reviewPathId}`,
        reviewPathId,
        formatDateTime(setTime(today, 0, 2)),
        formatDateTime(setTime(today, 0, 3)),
      ]
    );

    await conn.execute(
      `INSERT IGNORE INTO badges (user_id, badge_id, earned_at)
       VALUES
        (?, 'badge_conflict_reset', ?),
        (?, 'badge_self_trust', ?)`,
      [
        userId,
        formatDateTime(addDays(today, -6)),
        userId,
        formatDateTime(addDays(today, -1)),
      ]
    );

    await conn.execute(
      `INSERT INTO pattern_milestones (user_id, milestone_type, title, description, evidence_json, achieved_at)
       VALUES
        (?, 'cycle_breaker', 'Noticing the Loop Earlier', 'You started catching pressure spirals before they fully took over the day.', ?, ?),
        (?, 'boundary_shift', 'Protecting Recovery Time', 'You followed through on recovery windows instead of surrendering every gap to work.', ?, ?)`,
      [
        userId,
        JSON.stringify({ days: [formatDate(addDays(today, -8)), formatDate(addDays(today, -4))] }),
        formatDateTime(addDays(today, -4)),
        userId,
        JSON.stringify({ days: [formatDate(addDays(today, -3)), formatDate(addDays(today, -2))] }),
        formatDateTime(addDays(today, -2)),
      ]
    );

    for (let index = 0; index < HISTORY_DAYS; index += 1) {
      const storyDate = formatDate(addDays(today, -index));
      await conn.execute(
        `INSERT INTO daily_stories (user_id, date_key, panels, created_at)
         VALUES (?, ?, ?, ?)`,
        [
          userId,
          storyDate,
          JSON.stringify([
            { type: 'trigger', title: '触发', text: '会议里又冒出一句“还有一个需求…”，压力一下被顶了上来。', signal_source: 'chat' },
            { type: 'state', title: '状态', text: '肩膀和呼吸都变紧了，整个人像扛着看不见的重量。', signal_source: 'day_profiles' },
            { type: 'action', title: '行动', text: '你打开 William，做了一个短恢复动作，把自己从旧循环里拉出来。', signal_source: 'practice_completions' },
            { type: 'resolution', title: '转变', text: '晚一点走出门时，身体已经轻了一点，今天没有完全被压力吞掉。', signal_source: 'journals' },
          ]),
          formatDateTime(setTime(addDays(today, -index), 23, 40)),
        ]
      );
    }

    const [reflectionEntryResult] = await conn.execute(
      `INSERT INTO journey_reflection_entries (user_id, start_date, end_date, title, status, created_at, updated_at)
       VALUES (?, ?, ?, 'Single-day demo reflection', 'completed', ?, ?)`,
      [
        userId,
        formatDate(today),
        formatDate(today),
        formatDateTime(setTime(today, 22, 40)),
        formatDateTime(setTime(today, 22, 45)),
      ]
    );
    const reflectionEntryId = Number(reflectionEntryResult.insertId);
    const reflectionQuestions = [
      '今天最持续地消耗了我什么？',
      '我在哪个场景里最容易变得紧绷？',
      '今天哪一个小动作最能让我慢慢回来？',
      '如果明天只改一个边界，它应该是什么？',
    ];
    for (let index = 0; index < reflectionQuestions.length; index += 1) {
      await conn.execute(
        `INSERT INTO journey_reflection_answers (entry_id, question_index, question_text, answer_text, created_at, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          reflectionEntryId,
          index + 1,
          reflectionQuestions[index],
          `Demo reflection ${index + 1}: 我已经更清楚地看到，真正需要改变的是压力来时的应对方式，而不是继续靠意志硬撑。`,
        ]
      );
    }

    await conn.commit();
    console.log('[seed_full_demo_user] Done');
    console.log(`email: ${USER_EMAIL}`);
    console.log(`password: ${USER_PASSWORD}`);
    console.log(`userId: ${userId}`);
    console.log('Seeded features: history, journals, moods, chat, schedule, AI practices, monthly paths, daily AI review path, badges, stories, milestones, reflections.');
  } catch (error) {
    await conn.rollback();
    console.error('[seed_full_demo_user] Failed:', error);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main();
