#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const db = require('../src/utils/db');
const engine = require('../src/services/behaviorEngine');
const memoryService = require('../src/services/memoryService');
const { ensureChatSchema } = require('../src/services/chatSchemaService');

const createdUserIds = [];

async function main() {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalPost = axios.post;

  try {
    await ensureChatSchema();
    await memoryService.ensureMemorySchema();

    const results = [];
    results.push(await runModelDirectWriteCase());
    results.push(await runModelPendingPromotionCase());
    results.push(await runModelNoRememberCase());
    results.push(await runModelLoopWithoutRuleMatchCase());
    results.push(await runFallbackCase());

    const failures = results.filter((item) => !item.passed).length;
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      passed: failures === 0,
      totalCases: results.length,
      failures,
      cases: results,
    }, null, 2));

    if (failures > 0) {
      process.exitCode = 1;
    }

    function restore() {
      process.env.OPENAI_API_KEY = originalApiKey;
      axios.post = originalPost;
    }

    async function runModelDirectWriteCase() {
      process.env.OPENAI_API_KEY = 'audit-model-key';
      axios.post = async () => ({
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                results: [{
                  id: 's1',
                  items: [
                    {
                      kind: 'memory',
                      memoryType: 'goal',
                      summary: '用户最近在准备产品经理转岗',
                      confidence: 0.86,
                      sensitivity: 'low',
                      needsUserConfirmation: false,
                    },
                    {
                      kind: 'active_loop',
                      activeLoopType: 'difficult_conversation',
                      summary: '用户还卡在和老板开口谈转岗',
                      confidence: 0.83,
                      sensitivity: 'medium',
                      needsUserConfirmation: false,
                    },
                  ],
                }],
              }),
            },
          }],
        },
      });

      const user = await createAuditUser('memory_model_direct');
      const session = await createSession(user.id, 'memory_model_direct');
      await captureTurnForUser({
        userId: user.id,
        sessionId: session.id,
        content: '我最近在准备产品经理转岗，还没和老板开口。',
      });

      const memories = await memoryService.listUserMemories({ userId: user.id, limit: 20 });
      const loops = await memoryService.listUserActiveLoops({ userId: user.id, limit: 20 });
      const [candidateRows] = await db.execute(
        `SELECT status, kind, memory_type, active_loop_type
         FROM memory_candidates
         WHERE user_id = ?
         ORDER BY id ASC`,
        [user.id]
      );

      const passed = memories.some((item) => item.memoryType === 'goal')
        && loops.some((item) => item.loopType === 'difficult_conversation')
        && candidateRows.length === 2
        && candidateRows.every((row) => row.status === 'promoted');

      return {
        id: 'model_direct_write',
        memoryTypes: memories.map((item) => item.memoryType),
        loopTypes: loops.map((item) => item.loopType),
        candidateStatuses: candidateRows.map((row) => ({
          kind: row.kind,
          memoryType: row.memory_type,
          activeLoopType: row.active_loop_type,
          status: row.status,
        })),
        passed,
      };
    }

    async function runModelPendingPromotionCase() {
      process.env.OPENAI_API_KEY = 'audit-model-key';
      axios.post = async () => ({
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                results: [{
                  id: 's1',
                  items: [
                    {
                      kind: 'memory',
                      memoryType: 'trigger',
                      summary: '用户容易在周会发言前出现明显心慌',
                      confidence: 0.66,
                      sensitivity: 'medium',
                      needsUserConfirmation: false,
                    },
                  ],
                }],
              }),
            },
          }],
        },
      });

      const user = await createAuditUser('memory_model_pending');
      const session = await createSession(user.id, 'memory_model_pending');
      await captureTurnForUser({
        userId: user.id,
        sessionId: session.id,
        content: '每次想到周会发言我就会心慌。',
      });

      let memories = await memoryService.listUserMemories({ userId: user.id, limit: 20 });
      const [firstCandidateRows] = await db.execute(
        `SELECT status, kind, memory_type
         FROM memory_candidates
         WHERE user_id = ?
         ORDER BY id ASC`,
        [user.id]
      );

      await captureTurnForUser({
        userId: user.id,
        sessionId: session.id,
        content: '每次一想到周会发言我都会心慌。',
      });

      memories = await memoryService.listUserMemories({ userId: user.id, limit: 20 });
      const [allCandidateRows] = await db.execute(
        `SELECT status, kind, memory_type
         FROM memory_candidates
         WHERE user_id = ?
         ORDER BY id ASC`,
        [user.id]
      );

      const pendingBefore = firstCandidateRows.every((row) => row.status === 'pending');
      const promotedAfter = memories.some((item) => item.memoryType === 'trigger')
        && allCandidateRows.some((row) => row.status === 'promoted');

      return {
        id: 'model_pending_then_promote',
        firstCandidateStatuses: firstCandidateRows.map((row) => row.status),
        finalMemoryTypes: memories.map((item) => item.memoryType),
        finalCandidateStatuses: allCandidateRows.map((row) => row.status),
        passed: pendingBefore && promotedAfter,
      };
    }

    async function runModelNoRememberCase() {
      process.env.OPENAI_API_KEY = 'audit-model-key';
      axios.post = async () => ({
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                results: [{
                  id: 's1',
                  items: [],
                }],
              }),
            },
          }],
        },
      });

      const user = await createAuditUser('memory_model_none');
      const session = await createSession(user.id, 'memory_model_none');
      await captureTurnForUser({
        userId: user.id,
        sessionId: session.id,
        content: '今天有点烦。',
      });

      const memories = await memoryService.listUserMemories({ userId: user.id, limit: 20 });
      const loops = await memoryService.listUserActiveLoops({ userId: user.id, limit: 20 });
      const [candidateRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM memory_candidates
         WHERE user_id = ?`,
        [user.id]
      );

      return {
        id: 'model_no_remember',
        memoryCount: memories.length,
        loopCount: loops.length,
        candidateCount: Number(candidateRows[0]?.total || 0),
        passed: memories.length === 0 && loops.length === 0 && Number(candidateRows[0]?.total || 0) === 0,
      };
    }

    async function runModelLoopWithoutRuleMatchCase() {
      // 模型识别到 emotional_cycle loop，但规则层的 detectEmotionalCycleLoop 不会命中
      // （因为缺少"反复想/停不下来/内耗/循环"等第三层关键词）
      // 改动前：模型结果会被 alignModelPersistentCandidates 清空
      // 改动后：模型结果保留，由 promotion 阈值正常把关
      process.env.OPENAI_API_KEY = 'audit-model-key';
      axios.post = async () => ({
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                results: [{
                  id: 's1',
                  items: [
                    {
                      kind: 'active_loop',
                      activeLoopType: 'emotional_cycle',
                      summary: '用户最近持续被焦虑反复困扰',
                      confidence: 0.78,
                      sensitivity: 'low',
                      needsUserConfirmation: false,
                    },
                  ],
                }],
              }),
            },
          }],
        },
      });

      const user = await createAuditUser('memory_model_loop_no_rule');
      const session = await createSession(user.id, 'memory_model_loop_no_rule');
      // 这句话包含"最近一直很焦虑"，规则层会检测到 emotional_state memory，
      // 但不会检测到 emotional_cycle loop（缺少"反复想/内耗/循环"等词）
      await captureTurnForUser({
        userId: user.id,
        sessionId: session.id,
        content: '我最近一直很焦虑，每天都这样。',
      });

      const loops = await memoryService.listUserActiveLoops({ userId: user.id, limit: 20 });
      const [candidateRows] = await db.execute(
        `SELECT status, kind, active_loop_type
         FROM memory_candidates
         WHERE user_id = ? AND kind = 'active_loop'
         ORDER BY id ASC`,
        [user.id]
      );

      // 模型识别的 emotional_cycle loop 应该存在于 candidates 中（不再被清空）
      // 置信度 0.78 >= ACTIVE_LOOP_DIRECT_PROMOTE_THRESHOLD (0.68)，应该被直接 promoted
      const hasLoopCandidate = candidateRows.some(
        (row) => row.active_loop_type === 'emotional_cycle'
      );
      const hasPromotedLoop = loops.some(
        (item) => item.loopType === 'emotional_cycle'
      );

      return {
        id: 'model_loop_without_rule_match',
        loopTypes: loops.map((item) => item.loopType),
        candidateStatuses: candidateRows.map((row) => ({
          kind: row.kind,
          activeLoopType: row.active_loop_type,
          status: row.status,
        })),
        hasLoopCandidate,
        hasPromotedLoop,
        passed: hasLoopCandidate && hasPromotedLoop,
      };
    }

    async function runFallbackCase() {
      delete process.env.OPENAI_API_KEY;
      axios.post = async () => {
        throw new Error('should_not_call_model');
      };

      const user = await createAuditUser('memory_rules_fallback');
      const session = await createSession(user.id, 'memory_rules_fallback');
      await captureTurnForUser({
        userId: user.id,
        sessionId: session.id,
        content: '这阵子一直失眠，最近每晚都睡不好。',
      });

      const memories = await memoryService.listUserMemories({ userId: user.id, limit: 20 });
      const loops = await memoryService.listUserActiveLoops({ userId: user.id, limit: 20 });

      restore();

      return {
        id: 'rules_fallback',
        memoryTypes: memories.map((item) => item.memoryType),
        loopTypes: loops.map((item) => item.loopType),
        passed: memories.some((item) => item.memoryType === 'emotional_state')
          && loops.some((item) => item.loopType === 'sleep_recovery'),
      };
    }
  } catch (error) {
    console.error('[MemoryAudit] Failed:', error);
    process.exitCode = 1;
  } finally {
    process.env.OPENAI_API_KEY = originalApiKey;
    axios.post = originalPost;
    await cleanup();
    await db.end();
  }
}

async function captureTurnForUser({ userId, sessionId, content }) {
  const analysis = engine.analyzeText(content) || {
    stressEstimate: 5,
    dominantEmotion: 'neutral',
    cognitivePatterns: [],
    wordCount: 0,
  };

  const [userMessage] = await db.execute(
    'INSERT INTO chat_messages (session_id, user_id, role, content, attachments, analysis, voice_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [sessionId, userId, 'user', content, JSON.stringify([]), JSON.stringify(analysis), 'classic']
  );
  const [assistantMessage] = await db.execute(
    'INSERT INTO chat_messages (session_id, user_id, role, content, attachments, analysis, voice_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [sessionId, userId, 'assistant', '收到，我们继续。', JSON.stringify([]), null, 'classic']
  );

  await memoryService.captureTurn({
    userId,
    sessionId,
    mode: 'classic',
    userMessageId: userMessage.insertId,
    assistantMessageId: assistantMessage.insertId,
    userContent: content,
    assistantContent: '收到，我们继续。',
    analysis,
    disablePersistentMemory: false,
  });
}

async function createAuditUser(tag) {
  const [result] = await db.execute(
    `INSERT INTO users (
       email, password, name, age, bio, challenges, trigs, sleep, work, voice_mode, language, memory_enabled, onboarded
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'classic', 'zh-CN', 1, 1)`,
    [
      `${tag}_${Date.now()}@audit.local`,
      'audit',
      'Memory Audit',
      30,
      '',
      JSON.stringify([]),
      JSON.stringify([]),
      5,
      5,
    ]
  );
  createdUserIds.push(result.insertId);
  return { id: result.insertId };
}

async function createSession(userId, sessionKey) {
  const [result] = await db.execute(
    'INSERT INTO chat_sessions (user_id, session_key, is_temporary) VALUES (?, ?, 0)',
    [userId, `${sessionKey}_${Math.random().toString(36).slice(2, 8)}`]
  );
  return { id: result.insertId };
}

async function cleanup() {
  if (createdUserIds.length === 0) return;
  await db.execute(
    `DELETE FROM users WHERE id IN (${createdUserIds.map(() => '?').join(', ')})`,
    createdUserIds
  );
}

main();
