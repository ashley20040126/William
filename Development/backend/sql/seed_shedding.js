require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const USER_EMAIL = 'shedding@william.dev';
const USER_PASSWORD = 'Shedding123!';
const USER_NAME = 'shedding';

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

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function buildJournalText(dayIndex, stress, mood, theme, random) {
  const openers = [
    '今天最大的感受是',
    '我发现自己一直在想',
    '这一天结束后最明显的感觉是',
    '今天身体给我的信号是',
  ];
  const closers = [
    '我其实想慢一点，但总怕事情掉下来。',
    '我知道自己需要缓冲，可一忙起来就忘了。',
    '今天最想做的是把脑子里的声音先安静下来。',
    '如果明天还能记得，我想给自己留十分钟喘口气。',
  ];
  const themeLabelMap = {
    work: '工作推进和交付',
    relationship: '和家人及亲密关系里的回应',
    sleep: '睡眠和下班后的停不下来',
    focus: '注意力被反复切走',
    career: '职业方向和继续投入的意义',
    manager: '和老板的沟通',
    burnout: '一种持续性的疲惫感',
  };
  const themeLabel = themeLabelMap[theme] || theme;
  const middle = stress >= 7
    ? `工作节奏很紧，${themeLabel}这件事反复在脑子里转，我能感觉到自己一直没真正放松下来。`
    : stress >= 5
      ? `白天不算失控，但${themeLabel}还是让我有一点绷着，像是在心里一直挂着。`
      : `今天整体还算稳，${themeLabel}没有把我完全拉走，我能稍微感到一点余裕。`;
  const emotion = mood <= 1 ? '我对当下是有一点喜欢的。' : mood >= 3 ? '我对很多事情都有一点厌倦。' : '我还在找今天真正的重点。';
  return `${pick(random, openers)}：${middle}${emotion}${pick(random, closers)} Day ${dayIndex + 1}.`;
}

function buildAnalysis(theme, stress, mood) {
  const dominantEmotion = mood <= 1 ? 'joy' : mood >= 3 ? 'sadness' : stress >= 7 ? 'anxiety' : 'neutral';
  const patterns = [];
  if (stress >= 7) patterns.push('rumination');
  if (theme === 'work') patterns.push('all-or-nothing');
  if (theme === 'relationship') patterns.push('self-blame');
  return {
    sentimentScore: mood <= 1 ? 1.8 : mood >= 3 ? -1.6 : 0.2,
    dominantEmotion,
    stressEstimate: stress,
    topics: [theme, stress >= 7 ? 'pressure' : 'recovery'],
    cognitivePatterns: patterns,
    wordCount: 42,
    hasCrisisSignal: false,
    mood,
    stress,
  };
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'william_app',
    charset: 'utf8mb4',
  });

  const random = mulberry32(20260324);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const startDate = addDays(today, -59);

  const reflectionQuestions = [
    '现在的工作里，哪些部分是我真心喜欢的？',
    '现在的工作里，哪些部分只是惯性在撑？',
    '最近两个月最持续消耗我能量的事情是什么？',
    '我最常在什么场景下感到胸口发紧或呼吸变浅？',
    '我最容易忽视的身体信号是什么？',
    '最近哪一种关系互动最容易让我疲惫？',
    '我最近最想开始做、但一直往后推的一件事是什么？',
    '如果这个阶段只能放下一件事，它最应该是什么？',
    '最近哪一天我最接近崩溃？那天之前发生了什么？',
    '最近哪一天我反而比较稳？那天有什么不同？',
    '我对自己说过最苛刻的一句话是什么？',
    '如果换成朋友处在我的位置，我会怎么对他说？',
    '我最近最怕面对的一段沟通是什么？',
    '我真正想让对方听见的一句话是什么？',
    '我最近有哪些安排重要，但不一定都必须由我亲自承担？',
    '我在忙的时候最容易牺牲掉什么恢复动作？',
    '哪些高强度工作是值得的，哪些只是习惯性接住？',
    '这个阶段我是在追求成长，还是在避免失控？',
    '我最近最有成就感的一件小事是什么？',
    '我最近最想被理解但一直没说出口的部分是什么？',
    '我是否还喜欢自己现在每天投入时间的方式？为什么？',
    '如果下个周期只保留一个真正有效的恢复动作，它会是什么？',
    '我最近做过哪件事后，身体明显放松了一点？',
    '我最近最容易进入反刍的时段是什么时候？',
    '如果我给下个周期设一个边界，它应该是什么？',
    '有什么事我其实已经知道该调整，只是还没承认？',
    '我最近最期待的一件小事是什么？',
    '什么样的工作节奏会让我觉得“我还有自己”？',
    '如果下个月想活得更像自己一点，我准备先改哪一步？',
    '这一轮回看后，我想送给自己的一个提醒是什么？',
  ];

  try {
    await conn.beginTransaction();

    await conn.query(`
      CREATE TABLE IF NOT EXISTS journey_reflection_entries (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        title VARCHAR(160),
        status ENUM('draft','completed') NOT NULL DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_user_reflection_range (user_id, start_date, end_date)
      ) ENGINE=InnoDB
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS journey_reflection_answers (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        entry_id BIGINT UNSIGNED NOT NULL,
        question_index TINYINT UNSIGNED NOT NULL,
        question_text TEXT NOT NULL,
        answer_text TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_reflection_question (entry_id, question_index)
      ) ENGINE=InnoDB
    `);

    const passwordHash = await bcrypt.hash(USER_PASSWORD, 10);
    const [existingUsers] = await conn.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [USER_EMAIL]);
    let userId;

    if (existingUsers[0]) {
      userId = existingUsers[0].id;

      await clearExistingUserData(conn, userId);

      await conn.execute(
        `UPDATE users
         SET password = ?, name = ?, age = ?, bio = ?, challenges = ?, sleep = ?, work = ?, trigs = ?,
             voice_mode = ?, language = ?, archetype = ?, xp = ?, streak = ?, days_used = ?, onboarded = ?, last_active = NOW()
         WHERE id = ?`,
        [
          passwordHash,
          USER_NAME,
          29,
          '产品经理，最近两个月在高压迭代和自我怀疑之间来回切换，想重新把节奏找回来。',
          JSON.stringify([4, 2, 8]),
          2,
          3,
          JSON.stringify(['deadline', 'manager', 'family']),
          'classic',
          'zh-CN',
          'reflector',
          640,
          9,
          53,
          1,
          userId,
        ]
      );
    } else {
      const [userResult] = await conn.execute(
        `INSERT INTO users
         (email, password, name, age, bio, challenges, sleep, work, trigs, voice_mode, language, archetype, xp, streak, days_used, onboarded, last_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          USER_EMAIL,
          passwordHash,
          USER_NAME,
          29,
          '产品经理，最近两个月在高压迭代和自我怀疑之间来回切换，想重新把节奏找回来。',
          JSON.stringify([4, 2, 8]),
          2,
          3,
          JSON.stringify(['deadline', 'manager', 'family']),
          'classic',
          'zh-CN',
          'reflector',
          640,
          9,
          53,
          1,
        ]
      );
      userId = userResult.insertId;
    }

    const [sessionResult] = await conn.execute(
      'INSERT INTO chat_sessions (user_id, session_key) VALUES (?, ?)',
      [userId, 'session_seed_shedding']
    );
    const sessionId = sessionResult.insertId;

    const themes = ['work', 'relationship', 'sleep', 'focus', 'career', 'manager', 'burnout'];
    let lastAssistantMessageId = null;

    for (let index = 0; index < 60; index += 1) {
      const currentDate = addDays(startDate, index);
      const dateKey = formatDate(currentDate);
      const weekday = currentDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
      const weeklyWave = Math.sin(index / 4.8) * 1.1;
      const deadlineWave = index % 9 >= 6 ? 1.6 : 0;
      const recoveryWave = index % 14 === 5 ? -1.5 : 0;
      const recentPressureWave = index >= 30 ? 1.1 : 0;
      const cycleCrunchWave = index >= 42 && index <= 54 ? 1.3 : 0;
      const stress = Math.max(2, Math.min(9, Math.round((5.2 + weeklyWave + deadlineWave + recoveryWave + recentPressureWave + cycleCrunchWave + (random() - 0.5) * 1.4) * 10) / 10));
      const mood = Math.max(0, Math.min(4, Math.round((stress >= 7.5 ? 3.4 : stress >= 6 ? 2.4 : stress <= 3.5 ? 1 : 2) + (random() - 0.5) * 0.8)));
      const theme = pick(random, themes);
      const journalText = buildJournalText(index, stress, mood, theme, random);
      const analysis = buildAnalysis(theme, stress, mood);
      const ambient = Math.max(1.5, Math.min(8.5, Math.round((stress + (random() - 0.5) * 0.8) * 10) / 10));
      const practiceCount = index % 6 === 0 ? 1 : index % 10 === 0 ? 2 : 0;
      const practicesDone = practiceCount === 0 ? [] : practiceCount === 1 ? ['breathing_reset'] : ['breathing_reset', 'weekly_reflection'];

      await conn.execute(
        `INSERT INTO moods (user_id, mood, stress, note, note_analysis, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          mood,
          Math.round(stress),
          journalText.slice(0, 180),
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
          journalText,
          JSON.stringify(analysis),
          formatDateTime(setTime(currentDate, 22, 10)),
          formatDateTime(setTime(currentDate, 22, 10)),
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
          weekday,
          stress,
          4 - mood,
          stress,
          Math.min(10, stress + 0.7),
          ambient,
          Math.min(10, ambient + 0.6),
          index % 3 === 0 ? 2 : 1,
          180 + Math.round(random() * 120),
          JSON.stringify([analysis.dominantEmotion]),
          JSON.stringify([theme, stress >= 7 ? 'pressure' : 'recovery']),
          JSON.stringify(analysis.cognitivePatterns),
          260 + Math.round(random() * 80),
          2 + (index % 3),
          4 - mood,
          stress,
          Math.min(10, stress + 0.5),
          JSON.stringify([theme, mood >= 3 ? 'fatigue' : 'recovery']),
          JSON.stringify(analysis.cognitivePatterns),
          practiceCount,
          JSON.stringify(practicesDone),
          formatDateTime(setTime(currentDate, 23, 20)),
        ]
      );

      if (practiceCount > 0) {
        for (const practiceId of practicesDone) {
          await conn.execute(
            `INSERT INTO practice_completions (user_id, practice_id, time_slot, xp_awarded, completed_at)
             VALUES (?, ?, ?, ?, ?)`,
            [
              userId,
              practiceId,
              practiceId === 'weekly_reflection' ? 'evening' : 'midday',
              15,
              formatDateTime(setTime(currentDate, practiceId === 'weekly_reflection' ? 21 : 15)),
            ]
          );
        }
      }

      if (index % 4 === 0) {
        const userMessage = `今天感觉压力有点高，尤其是${theme}这块。我担心自己又会把事情扛过头，而且最近越来越像是没有缓冲地一直往前顶。`;
        const assistantMessage = '先别急着把后面所有事一起扛。把今天最紧的一件事挑出来，我们只先处理那一件，然后给它后面留一个短缓冲。';
        const [userMsgResult] = await conn.execute(
          `INSERT INTO chat_messages (session_id, user_id, role, content, attachments, analysis, created_at)
           VALUES (?, ?, 'user', ?, ?, ?, ?)`,
          [
            sessionId,
            userId,
            userMessage,
            JSON.stringify([]),
            JSON.stringify(analysis),
            formatDateTime(setTime(currentDate, 20, 5)),
          ]
        );
        lastAssistantMessageId = userMsgResult.insertId + 1;
        await conn.execute(
          `INSERT INTO chat_messages (session_id, user_id, role, content, attachments, analysis, created_at)
           VALUES (?, ?, 'assistant', ?, ?, ?, ?)`,
          [
            sessionId,
            userId,
            assistantMessage,
            JSON.stringify([]),
            null,
            formatDateTime(setTime(currentDate, 20, 7)),
          ]
        );
      }
    }

    await conn.execute(
      `INSERT INTO journey_enrollments (user_id, journey_id, current_step, started_at, completed_at)
       VALUES (?, 'stability', 2, ?, NULL)`,
      [userId, formatDateTime(addDays(today, -18))]
    );

    const scheduleTemplates = [
      { dayOffset: -50, title: '和老板做季度 review', location: '会议室 A', hour: 10, stress: 8 },
      { dayOffset: -43, title: '医院复诊', location: '协和医院', hour: 9, stress: 8 },
      { dayOffset: -36, title: '客户提案会', location: '线上 Zoom', hour: 14, stress: 7 },
      { dayOffset: -29, title: '和妈妈谈最近状态', location: '家里', hour: 20, stress: 7 },
      { dayOffset: -27, title: '项目里程碑汇报', location: '大会议室', hour: 11, stress: 8 },
      { dayOffset: -24, title: '产品需求评审会', location: '7F 小会议室', hour: 15, stress: 7 },
      { dayOffset: -21, title: '和老板做 one-on-one 沟通', location: '1:1 会议室', hour: 16, stress: 8 },
      { dayOffset: -19, title: '跨部门对齐 deadline', location: '线上 Zoom', hour: 10, stress: 7 },
      { dayOffset: -16, title: '绩效沟通', location: '1:1 会议室', hour: 16, stress: 7 },
      { dayOffset: -13, title: '客户复盘会', location: '线上 Zoom', hour: 14, stress: 7 },
      { dayOffset: -10, title: '周会汇报和风险说明', location: '主会议室', hour: 10, stress: 8 },
      { dayOffset: -8, title: '和朋友聊转岗可能性', location: '咖啡馆', hour: 19, stress: 6 },
      { dayOffset: -6, title: '去做一次深度按摩和恢复', location: '疗愈中心', hour: 18, stress: 3 },
      { dayOffset: -5, title: '周六去做一次长散步', location: '滨江公园', hour: 8, stress: 3 },
      { dayOffset: -3, title: '和老板确认下月节奏', location: '线上 Zoom', hour: 11, stress: 8 },
      { dayOffset: -1, title: '给自己留一晚完整月度反思', location: '家里', hour: 21, stress: 4 },
    ];

    for (const item of scheduleTemplates) {
      const baseDate = addDays(today, item.dayOffset);
      const startTime = setTime(baseDate, item.hour, 0);
      const endTime = setTime(baseDate, item.hour + 1, 0);
      const [messageResult] = await conn.execute(
        `INSERT INTO chat_messages (session_id, user_id, role, content, attachments, analysis, created_at)
         VALUES (?, ?, 'user', ?, ?, ?, ?)`,
        [
          sessionId,
          userId,
          `${formatDate(baseDate)} ${item.title}`,
          JSON.stringify([]),
          JSON.stringify({ stressEstimate: item.stress, dominantEmotion: item.stress >= 7 ? 'anxiety' : 'neutral', cognitivePatterns: [] }),
          formatDateTime(setTime(baseDate, item.hour - 2, 15)),
        ]
      );

      await conn.execute(
        `INSERT INTO schedule_candidates (
           user_id, session_id, source_message_id, title, start_time, end_time, date_text, location,
           participants_json, confidence, status, dedupe_key, meta_json, created_at, updated_at, confirmed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)`,
        [
          userId,
          sessionId,
          messageResult.insertId,
          item.title,
          formatDateTime(startTime),
          formatDateTime(endTime),
          formatDate(baseDate),
          item.location,
          JSON.stringify(item.title.includes('老板') ? ['老板'] : item.title.includes('妈妈') ? ['妈妈'] : item.title.includes('客户') ? ['客户'] : []),
          0.92,
          `${formatDate(baseDate)}:${item.title}`,
          JSON.stringify({ seeded: true, stressHint: item.stress }),
          formatDateTime(setTime(baseDate, item.hour - 2, 16)),
          formatDateTime(setTime(baseDate, item.hour - 2, 16)),
          formatDateTime(setTime(baseDate, item.hour - 2, 16)),
        ]
      );
    }

    const reflectionStart = formatDate(addDays(today, -29));
    const reflectionEnd = formatDate(today);
    const [reflectionResult] = await conn.execute(
      `INSERT INTO journey_reflection_entries (user_id, start_date, end_date, title, status)
       VALUES (?, ?, ?, ?, 'completed')`,
      [userId, reflectionStart, reflectionEnd, '30-question reflection']
    );
    const reflectionEntryId = reflectionResult.insertId;

    for (let i = 0; i < reflectionQuestions.length; i += 1) {
      await conn.execute(
        `INSERT INTO journey_reflection_answers (entry_id, question_index, question_text, answer_text)
         VALUES (?, ?, ?, ?)`,
        [
          reflectionEntryId,
          i + 1,
          reflectionQuestions[i],
          `Shedding 的回答 ${i + 1}：我最近越来越确定，真正需要调整的是工作节奏和边界，而不是继续更努力地硬撑。`,
        ]
      );
    }

    await conn.commit();
    console.log(JSON.stringify({
      ok: true,
      email: USER_EMAIL,
      password: USER_PASSWORD,
      name: USER_NAME,
      userId,
      sessionId,
      seededDays: 60,
      sampleAssistantMessageId: lastAssistantMessageId,
    }, null, 2));
  } catch (error) {
    await conn.rollback();
    console.error('[Seed Shedding] failed:', error);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

async function clearExistingUserData(conn, userId) {
  await conn.execute('DELETE FROM journey_reflection_entries WHERE user_id = ?', [userId]);
  await conn.execute('DELETE FROM outreach WHERE user_id = ?', [userId]);
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

main();
