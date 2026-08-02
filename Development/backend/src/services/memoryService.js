const axios = require('axios');
const { getProxyForUrl } = require('proxy-from-env');
const db = require('../utils/db');
const engine = require('./behaviorEngine');
const memoryClassifier = require('./memoryClassifierService');

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const INTENT_CLASSIFIER_MODEL = process.env.INTENT_CLASSIFIER_MODEL || 'gpt-4o-mini';
const INTENT_CLASSIFIER_TIMEOUT_MS = parseInt(process.env.INTENT_CLASSIFIER_TIMEOUT_MS || '5000', 10);

const RECENT_MESSAGE_LIMIT = parseInt(process.env.MEMORY_RECENT_MESSAGE_LIMIT || '8', 10);
const SUMMARY_LOOKBACK_LIMIT = parseInt(process.env.MEMORY_SUMMARY_LOOKBACK_LIMIT || '24', 10);
const USER_MEMORY_LIMIT = parseInt(process.env.MEMORY_USER_MEMORY_LIMIT || '12', 10);
const ACTIVE_LOOP_LIMIT = parseInt(process.env.MEMORY_ACTIVE_LOOP_LIMIT || '6', 10);
const DEBUG_EVENT_LIMIT = parseInt(process.env.MEMORY_DEBUG_EVENT_LIMIT || '30', 10);
const SESSION_MESSAGE_DEBUG_LIMIT = parseInt(process.env.MEMORY_SESSION_DEBUG_LIMIT || '20', 10);

const SESSION_SCOPE_BY_MODE = {
  classic: 'classic_bias',
  direct: 'expert_bias',
};

const MEMORY_STATUS = new Set(['active', 'suppressed', 'deleted']);
const ACTIVE_LOOP_STATUS = new Set(['active', 'resolved', 'dismissed']);
const MEMORY_DIRECT_PROMOTE_THRESHOLD = 0.78;
const MEMORY_REPEAT_PROMOTE_THRESHOLD = 0.64;
const ACTIVE_LOOP_DIRECT_PROMOTE_THRESHOLD = 0.68;
const ACTIVE_LOOP_REPEAT_PROMOTE_THRESHOLD = 0.6;

async function ensureMemorySchema() {
  await ensureColumn('chat_messages', 'attachments', 'ALTER TABLE chat_messages ADD COLUMN attachments JSON NULL AFTER content');
  await ensureColumn('users', 'memory_enabled', 'ALTER TABLE users ADD COLUMN memory_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER language');

  await db.query(`
    CREATE TABLE IF NOT EXISTS session_memories (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      session_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      scope ENUM('shared_session','classic_bias','expert_bias') NOT NULL,
      summary TEXT NOT NULL,
      key_topics JSON,
      open_loops JSON,
      last_message_id BIGINT UNSIGNED,
      message_count INT UNSIGNED DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_session_scope (session_id, scope),
      INDEX idx_user_scope (user_id, scope),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_memories (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      scope ENUM('shared_core','classic_bias','expert_bias') NOT NULL,
      memory_type VARCHAR(32) NOT NULL,
      content TEXT NOT NULL,
      canonical_key VARCHAR(160),
      confidence DECIMAL(4,2) DEFAULT 0.50,
      status ENUM('active','suppressed','deleted') DEFAULT 'active',
      times_seen INT UNSIGNED DEFAULT 1,
      source_message_id BIGINT UNSIGNED,
      source_session_id BIGINT UNSIGNED,
      is_user_confirmed TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      last_used_at TIMESTAMP NULL DEFAULT NULL,
      last_confirmed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_memory_scope (user_id, scope, memory_type),
      INDEX idx_user_memory_lookup (user_id, scope, memory_type, canonical_key),
      INDEX idx_user_memory_status (user_id, status, updated_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS memory_events (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      session_id BIGINT UNSIGNED NOT NULL,
      message_id BIGINT UNSIGNED,
      event_type VARCHAR(32) NOT NULL,
      rule_name VARCHAR(64),
      before_value TEXT,
      after_value TEXT,
      payload JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_event_time (user_id, created_at),
      INDEX idx_session_event_time (session_id, created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_active_loops (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      loop_type VARCHAR(32) NOT NULL,
      title VARCHAR(160) NOT NULL,
      summary TEXT,
      canonical_key VARCHAR(160),
      keywords JSON,
      confidence DECIMAL(4,2) DEFAULT 0.60,
      status ENUM('active','resolved','dismissed') DEFAULT 'active',
      times_seen INT UNSIGNED DEFAULT 1,
      source_message_id BIGINT UNSIGNED,
      source_session_id BIGINT UNSIGNED,
      due_hint VARCHAR(80),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_loop_status (user_id, status, updated_at),
      INDEX idx_user_loop_lookup (user_id, status, loop_type, canonical_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS memory_candidates (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      session_id BIGINT UNSIGNED NOT NULL,
      source_message_id BIGINT UNSIGNED NULL,
      source_sentence TEXT NOT NULL,
      kind ENUM('memory','active_loop') NOT NULL,
      memory_type VARCHAR(32) NULL,
      active_loop_type VARCHAR(32) NULL,
      summary VARCHAR(220) NOT NULL,
      canonical_key VARCHAR(160) NOT NULL,
      sensitivity ENUM('low','medium','high') NOT NULL DEFAULT 'low',
      confidence DECIMAL(4,2) NOT NULL DEFAULT 0.60,
      needs_user_confirmation TINYINT(1) NOT NULL DEFAULT 0,
      status ENUM('pending','promoted','rejected') NOT NULL DEFAULT 'pending',
      classifier_version VARCHAR(32) NULL,
      meta_json JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_memory_candidate_lookup (user_id, kind, canonical_key, status, created_at),
      INDEX idx_memory_candidate_message (source_message_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await ensureColumn('user_memories', 'canonical_key', 'ALTER TABLE user_memories ADD COLUMN canonical_key VARCHAR(160) NULL AFTER content');
  await ensureColumn('user_memories', 'status', "ALTER TABLE user_memories ADD COLUMN status ENUM('active','suppressed','deleted') NOT NULL DEFAULT 'active' AFTER confidence");
  await ensureColumn('user_memories', 'times_seen', 'ALTER TABLE user_memories ADD COLUMN times_seen INT UNSIGNED NOT NULL DEFAULT 1 AFTER status');
  await ensureColumn('user_memories', 'last_used_at', 'ALTER TABLE user_memories ADD COLUMN last_used_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at');
  await ensureColumn('user_active_loops', 'canonical_key', 'ALTER TABLE user_active_loops ADD COLUMN canonical_key VARCHAR(160) NULL AFTER summary');
  await ensureColumn('user_active_loops', 'keywords', 'ALTER TABLE user_active_loops ADD COLUMN keywords JSON NULL AFTER canonical_key');
  await ensureColumn('user_active_loops', 'confidence', 'ALTER TABLE user_active_loops ADD COLUMN confidence DECIMAL(4,2) NOT NULL DEFAULT 0.60 AFTER keywords');
  await ensureColumn('user_active_loops', 'status', "ALTER TABLE user_active_loops ADD COLUMN status ENUM('active','resolved','dismissed') NOT NULL DEFAULT 'active' AFTER confidence");
  await ensureColumn('user_active_loops', 'times_seen', 'ALTER TABLE user_active_loops ADD COLUMN times_seen INT UNSIGNED NOT NULL DEFAULT 1 AFTER status');
  await ensureColumn('user_active_loops', 'source_message_id', 'ALTER TABLE user_active_loops ADD COLUMN source_message_id BIGINT UNSIGNED NULL AFTER times_seen');
  await ensureColumn('user_active_loops', 'source_session_id', 'ALTER TABLE user_active_loops ADD COLUMN source_session_id BIGINT UNSIGNED NULL AFTER source_message_id');
  await ensureColumn('user_active_loops', 'due_hint', 'ALTER TABLE user_active_loops ADD COLUMN due_hint VARCHAR(80) NULL AFTER source_session_id');
  await ensureColumn('user_active_loops', 'last_seen_at', 'ALTER TABLE user_active_loops ADD COLUMN last_seen_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP AFTER updated_at');
  await ensureColumn('memory_events', 'rule_name', 'ALTER TABLE memory_events ADD COLUMN rule_name VARCHAR(64) NULL AFTER event_type');
  await ensureColumn('memory_events', 'before_value', 'ALTER TABLE memory_events ADD COLUMN before_value TEXT NULL AFTER rule_name');
  await ensureColumn('memory_events', 'after_value', 'ALTER TABLE memory_events ADD COLUMN after_value TEXT NULL AFTER before_value');
}

async function buildConversationContext({
  userId,
  sessionId,
  mode = 'classic',
  currentMessageId = null,
  disablePersistentMemory = false,
  queryText = '',
  hasKnowledgeInput = false,
}) {
  const context = await resolveConversationContext({
    userId,
    sessionId,
    mode,
    currentMessageId,
    includeDebug: false,
    markUsed: true,
    disablePersistentMemory,
    queryText,
    hasKnowledgeInput,
  });

  return {
    recentMessages: context.recentMessages,
    memoryContext: context.memoryContext,
    activeLoops: context.selectedActiveLoops || [],
    retrievalPlan: context.retrievalPlan || null,
  };
}

async function buildConversationContextDebug({
  userId,
  sessionId,
  mode = 'classic',
  currentMessageId = null,
  disablePersistentMemory = false,
  queryText = '',
  hasKnowledgeInput = false,
}) {
  return resolveConversationContext({
    userId,
    sessionId,
    mode,
    currentMessageId,
    includeDebug: true,
    markUsed: false,
    disablePersistentMemory,
    queryText,
    hasKnowledgeInput,
  });
}

async function getSessionDebugSnapshot({ userId, sessionId = null, sessionKey = null }) {
  const session = await findSession({ userId, sessionId, sessionKey });
  if (!session) return null;

  const messageLimit = clampPositiveInt(SESSION_MESSAGE_DEBUG_LIMIT, 20);
  const eventLimit = clampPositiveInt(DEBUG_EVENT_LIMIT, 30);
  const [messageRows, sessionMemoryRows, eventRows] = await Promise.all([
    db.execute(
      `SELECT id, role, content, attachments, analysis, created_at
       FROM chat_messages
       WHERE user_id = ? AND session_id = ?
       ORDER BY id DESC
       LIMIT ${messageLimit}`,
      [userId, session.id]
    ),
    db.execute(
      `SELECT id, scope, summary, key_topics, open_loops, last_message_id, message_count, updated_at
       FROM session_memories
       WHERE user_id = ? AND session_id = ?
       ORDER BY FIELD(scope, 'shared_session', 'classic_bias', 'expert_bias')`,
      [userId, session.id]
    ),
    db.execute(
      `SELECT id, event_type, rule_name, before_value, after_value, payload, created_at
       FROM memory_events
       WHERE user_id = ? AND session_id = ?
       ORDER BY id DESC
       LIMIT ${eventLimit}`,
      [userId, session.id]
    ),
  ]);

  const [classicContext, expertContext] = await Promise.all([
    buildConversationContextDebug({ userId, sessionId: session.id, mode: 'classic' }),
    buildConversationContextDebug({ userId, sessionId: session.id, mode: 'direct' }),
  ]);
  const activeLoops = await listUserActiveLoops({ userId, status: 'active', limit: 12 });

  return {
    session: {
      id: session.id,
      sessionKey: session.session_key,
      createdAt: session.created_at,
    },
    messages: messageRows[0].reverse().map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      attachments: safeParse(row.attachments, []),
      analysis: safeParse(row.analysis, null),
      createdAt: row.created_at,
    })),
    sessionMemories: sessionMemoryRows[0].map((row) => ({
      id: row.id,
      scope: row.scope,
      summary: row.summary,
      keyTopics: safeParse(row.key_topics, []),
      openLoops: safeParse(row.open_loops, []),
      lastMessageId: row.last_message_id,
      messageCount: row.message_count,
      updatedAt: row.updated_at,
    })),
    injectedContext: {
      classic: classicContext,
      direct: expertContext,
    },
    activeLoops,
    events: eventRows[0].map((row) => ({
      id: row.id,
      eventType: row.event_type,
      ruleName: row.rule_name,
      beforeValue: row.before_value,
      afterValue: row.after_value,
      payload: safeParse(row.payload, null),
      createdAt: row.created_at,
    })),
  };
}

async function listUserMemories({
  userId,
  scope = null,
  memoryType = null,
  status = null,
  limit = 100,
}) {
  const clauses = ['user_id = ?'];
  const params = [userId];

  if (scope) {
    clauses.push('scope = ?');
    params.push(scope);
  }
  if (memoryType) {
    clauses.push('memory_type = ?');
    params.push(memoryType);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }

  const queryLimit = clampPositiveInt(limit, 100);
  const [rows] = await db.execute(
    `SELECT id, scope, memory_type, content, canonical_key, confidence, status, times_seen,
            is_user_confirmed, source_message_id, source_session_id, created_at, updated_at,
            last_used_at, last_confirmed_at
     FROM user_memories
     WHERE ${clauses.join(' AND ')}
     ORDER BY status = 'active' DESC, confidence DESC, updated_at DESC
     LIMIT ${queryLimit}`,
    params
  );

  return rows.map(mapUserMemoryRow);
}

async function listUserActiveLoops({
  userId,
  status = 'active',
  limit = 20,
}) {
  const queryLimit = clampPositiveInt(limit, 20);
  const params = [userId];
  let where = 'WHERE user_id = ?';

  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }

  const [rows] = await db.execute(
    `SELECT id, loop_type, title, summary, canonical_key, keywords, confidence, status, times_seen,
            source_message_id, source_session_id, due_hint, created_at, updated_at, last_seen_at
     FROM user_active_loops
     ${where}
     ORDER BY status = 'active' DESC, confidence DESC, updated_at DESC
     LIMIT ${queryLimit}`,
    params
  );

  return rows.map(mapUserActiveLoopRow);
}

async function rebuildSessionMemories({ userId, sessionId = null, sessionKey = null, messageLimit = 200 }) {
  const session = await findSession({ userId, sessionId, sessionKey });
  if (!session) {
    throw new Error('Session not found');
  }

  const messages = await fetchSessionMessages(session.id, clampPositiveInt(messageLimit, 200));
  const latestMessageId = messages.at(-1)?.id || null;
  const summaries = buildAllSessionSummaries(messages);

  await persistSessionSummaries({
    sessionId: session.id,
    userId,
    latestMessageId,
    messageCount: messages.length,
    summaries,
  });

  await logMemoryEvent({
    userId,
    sessionId: session.id,
    messageId: latestMessageId,
    eventType: 'session_rebuilt',
    ruleName: 'manual_rebuild',
    payload: {
      messageCount: messages.length,
      scopes: Object.keys(summaries),
    },
  });

  return {
    sessionId: session.id,
    sessionKey: session.session_key,
    summaries,
  };
}

async function reextractUserMemories({ userId, sessionId = null, sessionKey = null, messageLimit = 200 }) {
  const session = await findSession({ userId, sessionId, sessionKey });
  if (!session) {
    throw new Error('Session not found');
  }

  const messages = await fetchSessionMessages(session.id, clampPositiveInt(messageLimit, 200));
  const userMessages = messages.filter((message) => message.role === 'user');
  let extractedCount = 0;
  let extractedActiveLoopCount = 0;
  const updatedMemoryIds = [];
  const updatedLoopIds = [];
  const skipped = [];

  for (const message of userMessages) {
    const extraction = extractMemoryCandidatesByRules({
      userContent: message.content,
      analysis: message.analysis,
      mode: 'classic',
    });

    extractedCount += extraction.candidates.length;
    skipped.push(...extraction.skipped.map((item) => ({ ...item, messageId: message.id })));
    const activeLoopExtraction = extractActiveLoopCandidatesByRules({
      userContent: message.content,
      analysis: message.analysis,
    });
    extractedActiveLoopCount += activeLoopExtraction.candidates.length;

    for (const candidate of extraction.candidates) {
      const result = await upsertUserMemory({
        userId,
        sessionId: session.id,
        sourceMessageId: message.id,
        ...candidate,
      });

      if (result?.memoryId) {
        updatedMemoryIds.push(result.memoryId);
      }
    }

    for (const candidate of activeLoopExtraction.candidates) {
      const result = await upsertActiveLoop({
        userId,
        sessionId: session.id,
        sourceMessageId: message.id,
        ...candidate,
      });
      if (result?.loopId) {
        updatedLoopIds.push(result.loopId);
      }
    }
  }

  await logMemoryEvent({
    userId,
    sessionId: session.id,
    messageId: messages.at(-1)?.id || null,
    eventType: 'user_reextracted',
    ruleName: 'manual_reextract',
    payload: {
      messageCount: userMessages.length,
      extractedCount,
      extractedActiveLoopCount,
      skipped,
      updatedMemoryIds: uniqueList(updatedMemoryIds),
      updatedLoopIds: uniqueList(updatedLoopIds),
    },
  });

  return {
    sessionId: session.id,
    sessionKey: session.session_key,
    messageCount: userMessages.length,
    extractedCount,
    extractedActiveLoopCount,
    skipped,
    updatedMemoryIds: uniqueList(updatedMemoryIds),
    updatedLoopIds: uniqueList(updatedLoopIds),
  };
}

async function updateUserMemoryStatus({ userId, memoryId, status }) {
  if (!MEMORY_STATUS.has(status)) {
    throw new Error('Invalid memory status');
  }

  const [rows] = await db.execute(
    `SELECT id, source_session_id, source_message_id, status, content
     FROM user_memories
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [memoryId, userId]
  );

  const memory = rows[0];
  if (!memory) {
    throw new Error('Memory not found');
  }

  await db.execute(
    `UPDATE user_memories
     SET status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [status, memoryId, userId]
  );

  if (memory.source_session_id) {
    await logMemoryEvent({
      userId,
      sessionId: memory.source_session_id,
      messageId: memory.source_message_id,
      eventType: 'memory_status_changed',
      ruleName: 'manual_status_update',
      beforeValue: memory.status,
      afterValue: status,
      payload: {
        memoryId,
        content: memory.content,
      },
    });
  }

  return {
    id: memoryId,
    status,
  };
}

async function updateUserActiveLoopStatus({ userId, loopId, status }) {
  if (!ACTIVE_LOOP_STATUS.has(status)) {
    throw new Error('Invalid active loop status');
  }

  const [rows] = await db.execute(
    `SELECT id, source_session_id, source_message_id, status, title
     FROM user_active_loops
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [loopId, userId]
  );

  const activeLoop = rows[0];
  if (!activeLoop) {
    throw new Error('Active loop not found');
  }

  await db.execute(
    `UPDATE user_active_loops
     SET status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [status, loopId, userId]
  );

  if (activeLoop.source_session_id) {
    await logMemoryEvent({
      userId,
      sessionId: activeLoop.source_session_id,
      messageId: activeLoop.source_message_id,
      eventType: 'active_loop_status_changed',
      ruleName: 'manual_active_loop_status_update',
      beforeValue: activeLoop.status,
      afterValue: status,
      payload: {
        loopId,
        title: activeLoop.title,
      },
    });
  }

  return {
    id: loopId,
    status,
  };
}

async function captureTurn({
  userId,
  sessionId,
  mode = 'classic',
  userMessageId,
  assistantMessageId,
  userContent,
  assistantContent,
  analysis,
  disablePersistentMemory = false,
}) {
  if (disablePersistentMemory) {
    return;
  }

  const summaryLookbackLimit = clampPositiveInt(SUMMARY_LOOKBACK_LIMIT, 24);
  const messages = await fetchSessionMessages(sessionId, summaryLookbackLimit);
  const latestMessageId = assistantMessageId || userMessageId || messages.at(-1)?.id || null;
  const summaries = buildAllSessionSummaries(messages);

  await persistSessionSummaries({
    sessionId,
    userId,
    latestMessageId,
    messageCount: messages.length,
    summaries,
  });

  const extraction = await extractPersistentCandidates({
    userId,
    sessionId,
    sourceMessageId: userMessageId,
    userContent,
    analysis,
    mode,
  });

  const upsertResults = [];
  for (const candidate of extraction.candidates) {
    const result = await upsertUserMemory({
      userId,
      sessionId,
      sourceMessageId: userMessageId,
      ...candidate,
    });
    if (result) upsertResults.push(result);
  }

  const activeLoopResults = [];
  for (const candidate of extraction.activeLoopCandidates) {
    const result = await upsertActiveLoop({
      userId,
      sessionId,
      sourceMessageId: userMessageId,
      ...candidate,
    });
    if (result) activeLoopResults.push(result);
  }

  await logMemoryEvent({
    userId,
    sessionId,
    messageId: assistantMessageId || userMessageId,
    eventType: 'turn_processed',
    ruleName: 'turn_capture',
    payload: {
      mode,
      extractedMemoryCount: extraction.candidates.length,
      extractedActiveLoopCount: extraction.activeLoopCandidates.length,
      extractionSource: extraction.source,
      classifierStatus: extraction.classifierStatus,
      extractedMemories: extraction.candidates.map((item) => ({
        scope: item.scope,
        memoryType: item.memoryType,
        content: item.content,
        canonicalKey: item.canonicalKey,
        ruleName: item.ruleName,
      })),
      extractedActiveLoops: extraction.activeLoopCandidates.map((item) => ({
        loopType: item.loopType,
        title: item.title,
        canonicalKey: item.canonicalKey,
        ruleName: item.ruleName,
      })),
      skippedSentences: extraction.skipped,
      memoryCandidateEvents: extraction.candidateEvents,
      memoryResults: upsertResults,
      activeLoopResults,
      replyPreview: cleanSnippet(assistantContent || '', 120),
    },
  });
}

async function resolveConversationContext({
  userId,
  sessionId,
  mode = 'classic',
  currentMessageId = null,
  includeDebug = false,
  markUsed = false,
  disablePersistentMemory = false,
  queryText = '',
  hasKnowledgeInput = false,
}) {
  const recentLimit = clampPositiveInt(RECENT_MESSAGE_LIMIT, 8);
  const roleScope = getRoleScope(mode);
  const retrievalPlan = disablePersistentMemory
    ? buildRetrievalPlanSync({ query: queryText, mode, hasKnowledgeInput })
    : await buildRetrievalPlan({ query: queryText, mode, hasKnowledgeInput });
  const [historyRows] = await Promise.all([
    db.execute(
      `SELECT id, role, content, analysis, created_at
       FROM chat_messages
       WHERE session_id = ?
         ${currentMessageId ? 'AND id < ?' : ''}
       ORDER BY id DESC
       LIMIT ${recentLimit}`,
      currentMessageId ? [sessionId, currentMessageId] : [sessionId]
    ),
  ]);

  const recentMessages = historyRows[0].reverse().map((row) => ({
    role: row.role,
    content: row.content,
  }));

  if (disablePersistentMemory) {
    if (!includeDebug) {
      return {
        recentMessages,
        memoryContext: '',
        retrievalPlan,
      };
    }

    return {
      recentMessages,
      memoryContext: '',
      sessionMemories: [],
      selectedUserMemories: [],
      selectedActiveLoops: [],
      retrievalPlan,
    };
  }

  const userMemoryLimit = clampPositiveInt(USER_MEMORY_LIMIT, 12);
  const activeLoopLimit = clampPositiveInt(ACTIVE_LOOP_LIMIT, 6);
  const memoryFetchLimit = Math.max(userMemoryLimit * 4, 24);
  const activeLoopFetchLimit = Math.max(activeLoopLimit * 3, 12);
  const [sessionRows, userMemoryRows, activeLoopRows] = await Promise.all([
    db.execute(
      `SELECT id, scope, summary, key_topics, open_loops, updated_at
       FROM session_memories
       WHERE user_id = ? AND session_id = ? AND scope IN ('shared_session', ?)`,
      [userId, sessionId, roleScope]
    ),
    db.execute(
      `SELECT id, scope, memory_type, content, canonical_key, confidence, status, times_seen,
              is_user_confirmed, updated_at, last_used_at, last_confirmed_at
       FROM user_memories
       WHERE user_id = ? AND status = 'active' AND scope IN ('shared_core', ?)
       ORDER BY updated_at DESC
       LIMIT ${memoryFetchLimit}`,
      [userId, roleScope]
    ),
    db.execute(
      `SELECT id, loop_type, title, summary, canonical_key, keywords, confidence, status, times_seen,
              source_message_id, source_session_id, due_hint, created_at, updated_at, last_seen_at
       FROM user_active_loops
       WHERE user_id = ? AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT ${activeLoopFetchLimit}`,
      [userId]
    ),
  ]);

  const rankedMemories = userMemoryRows[0]
    .map((row) => ({
      ...mapUserMemoryRow(row),
      rankScore: rankUserMemory(row, mode, retrievalPlan, queryText),
    }))
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, resolveSelectedMemoryLimit(retrievalPlan.intent, userMemoryLimit));

  const rankedActiveLoops = activeLoopRows[0]
    .map((row) => ({
      ...mapUserActiveLoopRow(row),
      rankScore: rankActiveLoop(row, retrievalPlan, queryText),
    }))
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, resolveSelectedActiveLoopLimit(retrievalPlan.intent, activeLoopLimit));

  if (markUsed && rankedMemories.length > 0) {
    markMemoriesUsed(rankedMemories.map((row) => row.id)).catch((error) => {
      console.error('[Memory] Failed to update last_used_at:', error.message);
    });
  }

  const memoryContext = formatMemoryContext(sessionRows[0], rankedMemories, rankedActiveLoops, mode, retrievalPlan);
  if (!includeDebug) {
    return {
      recentMessages,
      memoryContext,
      selectedUserMemories: rankedMemories,
      selectedActiveLoops: rankedActiveLoops,
      retrievalPlan,
    };
  }

  return {
    recentMessages,
    memoryContext,
    sessionMemories: sessionRows[0].map((row) => ({
      id: row.id,
      scope: row.scope,
      summary: row.summary,
      keyTopics: safeParse(row.key_topics, []),
      openLoops: safeParse(row.open_loops, []),
      updatedAt: row.updated_at,
    })),
    selectedUserMemories: rankedMemories,
    selectedActiveLoops: rankedActiveLoops,
    retrievalPlan,
  };
}

async function findSession({ userId, sessionId = null, sessionKey = null }) {
  if (sessionId) {
    const [rows] = await db.execute(
      `SELECT id, session_key, created_at
       FROM chat_sessions
       WHERE user_id = ? AND id = ?
       LIMIT 1`,
      [userId, sessionId]
    );
    return rows[0] || null;
  }

  if (!sessionKey) return null;

  const [rows] = await db.execute(
    `SELECT id, session_key, created_at
     FROM chat_sessions
     WHERE user_id = ? AND session_key = ?
     LIMIT 1`,
    [userId, sessionKey]
  );
  return rows[0] || null;
}

async function fetchSessionMessages(sessionId, limit) {
  const queryLimit = clampPositiveInt(limit, SUMMARY_LOOKBACK_LIMIT);
  const [rows] = await db.execute(
    `SELECT id, role, content, analysis
     FROM chat_messages
     WHERE session_id = ?
     ORDER BY id DESC
     LIMIT ${queryLimit}`,
    [sessionId]
  );

  return rows.reverse().map(normalizeMessageRow);
}

function normalizeMessageRow(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    analysis: safeParse(row.analysis, null),
  };
}

function buildAllSessionSummaries(messages) {
  return {
    shared_session: buildSharedSessionSummary(messages),
    classic_bias: buildClassicSessionSummary(messages),
    expert_bias: buildExpertSessionSummary(messages),
  };
}

async function persistSessionSummaries({ sessionId, userId, latestMessageId, messageCount, summaries }) {
  await Promise.all([
    upsertSessionMemory({
      sessionId,
      userId,
      scope: 'shared_session',
      summary: summaries.shared_session.summary,
      keyTopics: summaries.shared_session.keyTopics,
      openLoops: summaries.shared_session.openLoops,
      lastMessageId: latestMessageId,
      messageCount,
    }),
    upsertSessionMemory({
      sessionId,
      userId,
      scope: 'classic_bias',
      summary: summaries.classic_bias.summary,
      keyTopics: summaries.classic_bias.keyTopics,
      openLoops: summaries.classic_bias.openLoops,
      lastMessageId: latestMessageId,
      messageCount,
    }),
    upsertSessionMemory({
      sessionId,
      userId,
      scope: 'expert_bias',
      summary: summaries.expert_bias.summary,
      keyTopics: summaries.expert_bias.keyTopics,
      openLoops: summaries.expert_bias.openLoops,
      lastMessageId: latestMessageId,
      messageCount,
    }),
  ]);
}

function formatMemoryContext(sessionRows, userMemories, activeLoops, mode, retrievalPlan = null) {
  const sharedSession = sessionRows.find((row) => row.scope === 'shared_session');
  const biasSession = sessionRows.find((row) => row.scope === getRoleScope(mode));
  const sharedCoreMemories = userMemories.filter((row) => row.scope === 'shared_core');
  const biasMemories = userMemories.filter((row) => row.scope === getRoleScope(mode));
  const sections = [];
  const intent = retrievalPlan?.intent || 'general_support';
  const includeSessionSummary = !['file_or_url_followup', 'schedule_logistics'].includes(intent);
  const includeBiasSummary = !['file_or_url_followup', 'memory_audit', 'schedule_logistics'].includes(intent);
  const compactGeneralSupport = intent === 'general_support';

  if (activeLoops.length > 0) {
    sections.push([
      intent === 'memory_audit' ? '【当前在持续推进或反复卡住的事项】' : '【当前进行中的问题/目标】',
      ...activeLoops.map((row) => `- ${compactGeneralSupport ? row.title : (row.summary || row.title)}`),
    ].join('\n'));
  }

  if (sharedCoreMemories.length > 0) {
    sections.push([
      '【共享长期记忆】',
      ...sharedCoreMemories.map((row) => `- ${row.content}`),
    ].join('\n'));
  }

  if (biasMemories.length > 0 && !compactGeneralSupport) {
    sections.push([
      mode === 'direct' ? '【专家模式优先记忆】' : '【陪伴模式优先记忆】',
      ...biasMemories.map((row) => `- ${row.content}`),
    ].join('\n'));
  }

  if (includeSessionSummary && sharedSession?.summary && !compactGeneralSupport) {
    sections.push(`【当前会话摘要】\n${sharedSession.summary}`);
  }

  if (includeBiasSummary && biasSession?.summary && !compactGeneralSupport) {
    sections.push(`${mode === 'direct' ? '【专家视角摘要】' : '【陪伴视角摘要】'}\n${biasSession.summary}`);
  }

  return cleanSnippet(sections.join('\n\n').trim(), 6000);
}

function buildSharedSessionSummary(messages) {
  const summaryMessages = getSummaryMessages(messages);
  const userMessages = summaryMessages.filter((message) => message.role === 'user');
  const assistantMessages = summaryMessages.filter((message) => message.role === 'assistant');
  const keyTopics = collectTopics(userMessages);
  const openLoops = collectOpenLoops(messages);
  const emotionTrend = collectEmotionTrend(userMessages);
  const latestUserPoints = userMessages.slice(-3).map((message) => cleanSnippet(message.content, 72));
  const assistantTakeaways = assistantMessages.slice(-2).map((message) => cleanSnippet(message.content, 72));
  const lines = [];

  if (latestUserPoints.length > 0) {
    lines.push(`用户最近持续在谈：${latestUserPoints.join('；')}`);
  }
  if (assistantTakeaways.length > 0) {
    lines.push(`此前已经回应过：${assistantTakeaways.join('；')}`);
  }
  if (emotionTrend) {
    lines.push(`最近情绪基调：${emotionTrend}`);
  }
  if (keyTopics.length > 0) {
    lines.push(`高频主题：${keyTopics.join('、')}`);
  }
  if (openLoops.length > 0) {
    lines.push(`仍未聊透的问题：${openLoops.join('；')}`);
  }

  return {
    summary: lines.join('\n'),
    keyTopics,
    openLoops,
  };
}

function buildClassicSessionSummary(messages) {
  const summaryMessages = getSummaryMessages(messages);
  const userMessages = summaryMessages.filter((message) => message.role === 'user');
  const supportSignals = userMessages
    .map((message) => detectSupportPreference(message.content))
    .filter(Boolean);
  const emotionalTriggers = userMessages
    .map((message) => detectTriggerSentence(message.content))
    .filter(Boolean)
    .slice(-3);
  const stableEmotions = userMessages
    .map((message) => detectStableEmotionalState(message.content, message.analysis))
    .filter(Boolean)
    .slice(-3);
  const lines = [];

  if (supportSignals.length > 0) {
    lines.push(`用户更容易接受的陪伴方式：${uniqueList(supportSignals).join('；')}`);
  }
  if (emotionalTriggers.length > 0) {
    lines.push(`最近容易被触发的点：${uniqueList(emotionalTriggers).join('；')}`);
  }
  if (stableEmotions.length > 0) {
    lines.push(`近期更稳定的情绪负荷：${uniqueList(stableEmotions).join('；')}`);
  }

  return {
    summary: lines.join('\n'),
    keyTopics: collectTopics(userMessages),
    openLoops: collectOpenLoops(messages),
  };
}

function buildExpertSessionSummary(messages) {
  const summaryMessages = getSummaryMessages(messages);
  const userMessages = summaryMessages.filter((message) => message.role === 'user');
  const recurringPatterns = userMessages
    .map((message) => detectRecurringPattern(message.content))
    .filter(Boolean)
    .slice(-3);
  const actionHistory = userMessages
    .map((message) => detectActionHistory(message.content))
    .filter(Boolean)
    .slice(-3);
  const lines = [];

  if (recurringPatterns.length > 0) {
    lines.push(`用户正在反复卡住的模式：${uniqueList(recurringPatterns).join('；')}`);
  }
  if (actionHistory.length > 0) {
    lines.push(`用户已经尝试过：${uniqueList(actionHistory).join('；')}`);
  }

  return {
    summary: lines.join('\n'),
    keyTopics: collectTopics(userMessages),
    openLoops: collectOpenLoops(messages),
  };
}

function getSummaryMessages(messages) {
  if (messages.length <= RECENT_MESSAGE_LIMIT) return messages;
  return messages.slice(0, -RECENT_MESSAGE_LIMIT);
}

async function extractPersistentCandidates({ userId, sessionId, sourceMessageId, userContent, analysis, mode }) {
  const skipped = [];
  const eligibleSentences = [];

  splitSentences(userContent).forEach((sentence, index) => {
    const text = sentence.trim();
    if (text.length < 8) {
      skipped.push({ sentence: text, reason: 'too_short' });
      return;
    }

    const ignoreReason = getSentenceIgnoreReason(text);
    if (ignoreReason) {
      skipped.push({ sentence: text, reason: ignoreReason });
      return;
    }

    eligibleSentences.push({
      id: `s${index + 1}`,
      text,
    });
  });

  if (eligibleSentences.length === 0) {
    return {
      candidates: [],
      activeLoopCandidates: [],
      skipped,
      source: 'none',
      classifierStatus: 'skipped',
      candidateEvents: [],
    };
  }

  const classifierResult = await memoryClassifier.classifyMemorySentences({
    sentences: eligibleSentences,
    mode,
  });

  const ruleExtraction = extractMemoryCandidatesByRules({ userContent, analysis, mode });
  const activeLoopExtraction = extractActiveLoopCandidatesByRules({ userContent, analysis });

  if (classifierResult.status === 'success') {
    const classification = await buildModelPersistentCandidates({
      userId,
      sessionId,
      sourceMessageId,
      mode,
      eligibleSentences,
      classifierResult,
    });
    const aligned = alignModelPersistentCandidates({
      userContent,
      modelClassification: classification,
      ruleExtraction,
      activeLoopExtraction,
    });

    return {
      ...aligned,
      skipped,
      source: aligned.ruleSupplemented ? 'model+rules' : 'model',
      classifierStatus: classifierResult.status,
    };
  }

  return {
    candidates: ruleExtraction.candidates,
    activeLoopCandidates: activeLoopExtraction.candidates,
    skipped,
    source: 'rules_fallback',
    classifierStatus: classifierResult.status,
    candidateEvents: [],
  };
}

function extractMemoryCandidatesByRules({ userContent, analysis, mode }) {
  const candidates = [];
  const skipped = [];
  const roleScope = getRoleScope(mode);

  splitSentences(userContent).forEach((sentence) => {
    const text = sentence.trim();
    if (text.length < 8) {
      skipped.push({ sentence: text, reason: 'too_short' });
      return;
    }

    const ignoreReason = getSentenceIgnoreReason(text);
    if (ignoreReason) {
      skipped.push({ sentence: text, reason: ignoreReason });
      return;
    }

    const goal = detectGoal(text);
    if (goal) {
      candidates.push(makeMemory('shared_core', 'goal', goal, 0.84, 'goal_intent'));
    }

    const preference = detectPreference(text);
    if (preference) {
      candidates.push(makeMemory('shared_core', 'preference', preference, 0.82, 'preference_explicit'));
    }

    const relationship = detectRelationship(text);
    if (relationship) {
      candidates.push(makeMemory('shared_core', 'relationship', relationship, 0.8, 'relationship_entity'));
    }

    const supportPreference = detectSupportPreference(text);
    if (supportPreference) {
      candidates.push(makeMemory(roleScope, 'support_style', supportPreference, 0.9, 'support_preference'));
    }

    const trigger = detectTriggerSentence(text);
    if (trigger) {
      candidates.push(makeMemory('shared_core', 'trigger', trigger, 0.76, 'trigger_pattern'));
      candidates.push(makeMemory('classic_bias', 'trigger', trigger, 0.8, 'trigger_pattern'));
    }

    const recurringPattern = detectRecurringPattern(text);
    if (recurringPattern) {
      candidates.push(makeMemory('expert_bias', 'problem_pattern', recurringPattern, 0.82, 'recurring_pattern'));
    }

    const actionHistory = detectActionHistory(text);
    if (actionHistory) {
      candidates.push(makeMemory('expert_bias', 'action_history', actionHistory, 0.78, 'action_history'));
    }

    const stableEmotion = detectStableEmotionalState(text, analysis);
    if (stableEmotion) {
      candidates.push(makeMemory('classic_bias', 'emotional_state', stableEmotion, 0.74, 'stable_emotion'));
    }
  });

  return {
    candidates: dedupeCandidates(candidates),
    skipped,
  };
}

function extractActiveLoopCandidatesByRules({ userContent, analysis }) {
  const candidates = [];

  splitSentences(userContent).forEach((sentence) => {
    const text = sentence.trim();
    if (text.length < 8) return;
    if (getSentenceIgnoreReason(text)) return;

    const goalProcess = detectGoalProcessLoop(text);
    if (goalProcess) {
      candidates.push(goalProcess);
    }

    const difficultConversation = detectDifficultConversationLoop(text);
    if (difficultConversation) {
      candidates.push(difficultConversation);
    }

    const sleepRecovery = detectSleepRecoveryLoop(text);
    if (sleepRecovery) {
      candidates.push(sleepRecovery);
    }

    const upcomingCommitment = detectUpcomingCommitmentLoop(text);
    if (upcomingCommitment) {
      candidates.push(upcomingCommitment);
    }

    const emotionalCycle = detectEmotionalCycleLoop(text, analysis);
    if (emotionalCycle) {
      candidates.push(emotionalCycle);
    }
  });

  return {
    candidates: dedupeActiveLoopCandidates(candidates),
  };
}

async function buildModelPersistentCandidates({
  userId,
  sessionId,
  sourceMessageId,
  mode,
  eligibleSentences,
  classifierResult,
}) {
  const byId = new Map((classifierResult.results || []).map((item) => [item.id, item]));
  const candidates = [];
  const activeLoopCandidates = [];
  const candidateEvents = [];

  for (const sentence of eligibleSentences) {
    const result = byId.get(sentence.id);
    const items = Array.isArray(result?.items) ? result.items : [];
    for (const item of items) {
      const persistables = expandClassifierItem(item, { mode, sourceText: sentence.text });
      for (const persistable of persistables) {
        const candidateEvent = await persistMemoryCandidate({
          userId,
          sessionId,
          sourceMessageId,
          sourceSentence: sentence.text,
          classifierVersion: classifierResult.version,
          summary: persistable.summary || persistable.content,
          activeLoopType: persistable.activeLoopType || persistable.loopType,
          ...persistable,
        });
        const evidenceCount = await countMemoryCandidateEvidence({
          userId,
          kind: candidateEvent.kind,
          canonicalKey: candidateEvent.canonicalKey,
        });
        const userConfirmed = detectUserConfirmationSignal(sentence.text);
        const shouldPromote = shouldPromoteCandidate({
          kind: candidateEvent.kind,
          confidence: persistable.confidence,
          sensitivity: persistable.sensitivity,
          needsUserConfirmation: persistable.needsUserConfirmation,
          evidenceCount,
          userConfirmed,
        });

        if (shouldPromote) {
          await markMemoryCandidateStatus(candidateEvent.id, 'promoted');
          candidateEvents.push({ ...candidateEvent, status: 'promoted', evidenceCount });
          if (persistable.kind === 'memory') {
            candidates.push(persistable);
          } else {
            activeLoopCandidates.push(persistable);
          }
        } else {
          candidateEvents.push({ ...candidateEvent, status: 'pending', evidenceCount });
        }
      }
    }
  }

  return {
    candidates: dedupeCandidates(candidates),
    activeLoopCandidates: dedupeActiveLoopCandidates(activeLoopCandidates),
    candidateEvents,
  };
}

function alignModelPersistentCandidates({
  userContent,
  modelClassification,
  ruleExtraction,
  activeLoopExtraction,
}) {
  let candidates = Array.isArray(modelClassification?.candidates)
    ? [...modelClassification.candidates]
    : [];
  let activeLoopCandidates = Array.isArray(modelClassification?.activeLoopCandidates)
    ? [...modelClassification.activeLoopCandidates]
    : [];
  const candidateEvents = Array.isArray(modelClassification?.candidateEvents)
    ? modelClassification.candidateEvents
    : [];

  const hasRuleActionHistory = ruleExtraction.candidates.some((item) => item.memoryType === 'action_history');
  const hasPreparationSignal = /(?:我最近在准备|我现在在准备|我正在准备)/.test(userContent);
  if (hasRuleActionHistory && !hasPreparationSignal) {
    activeLoopCandidates = activeLoopCandidates.filter((item) => item.loopType !== 'goal_process');
  }

  const hasRuleTrigger = ruleExtraction.candidates.some((item) => item.memoryType === 'trigger');
  const hasRuleStableEmotion = ruleExtraction.candidates.some((item) => item.memoryType === 'emotional_state');
  if (!hasRuleTrigger) {
    candidates = candidates.filter((item) => !(item.memoryType === 'trigger' && item.ruleName === 'model_memory_classifier'));
  }
  if (hasRuleTrigger && !hasRuleStableEmotion) {
    candidates = candidates.filter((item) => item.memoryType !== 'emotional_state');
  }

  // 规则检测到的 loop 类型作为增强信号，但不再否决模型结果。
  // 如果规则也检测到了同类 loop，boost 模型候选的置信度；
  // 如果规则没有检测到任何 loop，模型结果仍然保留（由 promotion 阈值把关）。
  const ruleLoopTypes = new Set(activeLoopExtraction.candidates.map((item) => item.loopType));
  if (ruleLoopTypes.size > 0) {
    activeLoopCandidates = activeLoopCandidates.map((item) => {
      if (ruleLoopTypes.has(item.loopType)) {
        return { ...item, confidence: Math.min(item.confidence + 0.06, 0.98) };
      }
      return item;
    });
  }

  const seenMemoryKeys = new Set(candidates.map((item) => `${item.memoryType}::${item.canonicalKey}`));
  const seenLoopKeys = new Set(activeLoopCandidates.map((item) => `${item.loopType}::${item.canonicalKey}`));
  let ruleSupplemented = false;

  for (const candidate of ruleExtraction.candidates) {
    const key = `${candidate.memoryType}::${candidate.canonicalKey}`;
    if (seenMemoryKeys.has(key)) continue;
    candidates.push(candidate);
    seenMemoryKeys.add(key);
    ruleSupplemented = true;
  }

  for (const candidate of activeLoopExtraction.candidates) {
    const key = `${candidate.loopType}::${candidate.canonicalKey}`;
    if (seenLoopKeys.has(key)) continue;
    activeLoopCandidates.push(candidate);
    seenLoopKeys.add(key);
    ruleSupplemented = true;
  }

  return {
    candidates: dedupeCandidates(candidates),
    activeLoopCandidates: dedupeActiveLoopCandidates(activeLoopCandidates),
    candidateEvents,
    ruleSupplemented,
  };
}

function expandClassifierItem(item, { mode, sourceText }) {
  if (item.kind === 'active_loop') {
    return [makeModelActiveLoop(item, sourceText)];
  }

  const records = [];
  if (item.memoryType === 'trigger') {
    records.push(makeModelMemory('shared_core', item.memoryType, item.summary, item.confidence, sourceText, 'model_memory_classifier', item));
    records.push(makeModelMemory('classic_bias', item.memoryType, item.summary, Math.min(item.confidence + 0.04, 0.98), sourceText, 'model_memory_classifier', item));
    return records.filter(Boolean);
  }

  records.push(makeModelMemory(resolveScopeForMemoryType(item.memoryType, mode), item.memoryType, item.summary, item.confidence, sourceText, 'model_memory_classifier', item));
  return records.filter(Boolean);
}

function makeModelMemory(scope, memoryType, content, confidence, sourceText, ruleName, item) {
  const normalizedContent = cleanSnippet(content, 160);
  if (!normalizedContent) return null;

  return {
    kind: 'memory',
    scope,
    memoryType,
    content: normalizedContent,
    confidence,
    ruleName,
    sensitivity: item.sensitivity || 'low',
    needsUserConfirmation: Boolean(item.needsUserConfirmation),
    canonicalKey: buildCanonicalKey(memoryType, normalizedContent),
    isUserConfirmed: detectUserConfirmationSignal(sourceText),
  };
}

function makeModelActiveLoop(item, sourceText) {
  const title = deriveLoopTitle(item.activeLoopType, item.summary, sourceText);
  return {
    kind: 'active_loop',
    loopType: item.activeLoopType,
    title,
    summary: cleanSnippet(item.summary, 220),
    confidence: item.confidence,
    ruleName: 'model_memory_classifier',
    dueHint: deriveLoopDueHint(item.activeLoopType, sourceText),
    keywords: extractRetrievalTerms(sourceText).slice(0, 5),
    canonicalKey: buildActiveLoopCanonicalKey(item.activeLoopType, title),
    sensitivity: item.sensitivity || 'low',
    needsUserConfirmation: Boolean(item.needsUserConfirmation),
  };
}

function resolveScopeForMemoryType(memoryType, mode) {
  if (memoryType === 'support_style') return getRoleScope(mode);
  if (memoryType === 'emotional_state') return 'classic_bias';
  if (memoryType === 'problem_pattern' || memoryType === 'action_history') return 'expert_bias';
  return 'shared_core';
}

function deriveLoopTitle(loopType, summary, sourceText) {
  const relationship = extractRelationshipEntity(sourceText);
  if (loopType === 'difficult_conversation' && relationship) {
    return `和${relationship}开口`;
  }
  if (loopType === 'goal_process') {
    const fragment = trimMemoryFragment(sourceText.replace(/^(我最近在准备|我现在在准备|我正在准备)/, ''));
    if (fragment) return `准备${fragment}`;
  }
  if (loopType === 'sleep_recovery') return '睡眠恢复';
  if (loopType === 'upcoming_commitment') {
    const timeMatch = sourceText.match(/(今天|明天|后天|这周|下周|周[一二三四五六日天]|本周)/);
    const eventMatch = sourceText.match(/(复诊|面试|汇报|考试|沟通|开会|见面|回访|约谈)/);
    if (timeMatch && eventMatch) return `${timeMatch[1]}${eventMatch[1]}`;
  }
  if (loopType === 'emotional_cycle') {
    const emotion = sourceText.match(/(焦虑|低落|压力很大|害怕|拖延|压抑|委屈|崩溃|紧张)/)?.[1];
    if (emotion) return `${emotion}循环`;
  }
  return cleanSnippet(summary, 80);
}

function deriveLoopDueHint(loopType, sourceText) {
  if (loopType !== 'upcoming_commitment') return '';
  return sourceText.match(/(今天|明天|后天|这周|下周|周[一二三四五六日天]|本周)/)?.[1] || '';
}

async function persistMemoryCandidate({
  userId,
  sessionId,
  sourceMessageId,
  sourceSentence,
  classifierVersion,
  kind,
  memoryType = '',
  activeLoopType = '',
  summary,
  canonicalKey,
  confidence,
  sensitivity = 'low',
  needsUserConfirmation = false,
}) {
  const [result] = await db.execute(
    `INSERT INTO memory_candidates (
       user_id, session_id, source_message_id, source_sentence, kind, memory_type, active_loop_type, summary,
       canonical_key, sensitivity, confidence, needs_user_confirmation, status, classifier_version, meta_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      userId,
      sessionId,
      sourceMessageId || null,
      sourceSentence,
      kind,
      memoryType || null,
      activeLoopType || null,
      summary,
      canonicalKey,
      sensitivity,
      confidence,
      needsUserConfirmation ? 1 : 0,
      classifierVersion || null,
      JSON.stringify({}),
    ]
  );

  return {
    id: result.insertId,
    kind,
    memoryType,
    activeLoopType,
    canonicalKey,
    confidence,
    sensitivity,
  };
}

async function countMemoryCandidateEvidence({ userId, kind, canonicalKey }) {
  const [rows] = await db.execute(
    `SELECT COUNT(DISTINCT COALESCE(source_message_id, id)) AS evidence_count
     FROM memory_candidates
     WHERE user_id = ? AND kind = ? AND canonical_key = ? AND status <> 'rejected'`,
    [userId, kind, canonicalKey]
  );
  return Number(rows[0]?.evidence_count || 0);
}

async function markMemoryCandidateStatus(candidateId, status) {
  await db.execute(
    `UPDATE memory_candidates
     SET status = ?
     WHERE id = ?`,
    [status, candidateId]
  );
}

function shouldPromoteCandidate({
  kind,
  confidence,
  sensitivity = 'low',
  needsUserConfirmation = false,
  evidenceCount = 1,
  userConfirmed = false,
}) {
  if (needsUserConfirmation && !userConfirmed) {
    return false;
  }

  if (sensitivity === 'high' && !userConfirmed && confidence < 0.9) {
    return false;
  }

  if (kind === 'memory') {
    if (confidence >= MEMORY_DIRECT_PROMOTE_THRESHOLD) return true;
    return evidenceCount >= 2 && confidence >= MEMORY_REPEAT_PROMOTE_THRESHOLD;
  }

  if (confidence >= ACTIVE_LOOP_DIRECT_PROMOTE_THRESHOLD) return true;
  return evidenceCount >= 2 && confidence >= ACTIVE_LOOP_REPEAT_PROMOTE_THRESHOLD;
}

function makeMemory(scope, memoryType, content, confidence, ruleName) {
  const normalizedContent = cleanSnippet(content, 160);
  return {
    scope,
    memoryType,
    content: normalizedContent,
    confidence,
    ruleName,
    canonicalKey: buildCanonicalKey(memoryType, normalizedContent),
    isUserConfirmed: detectUserConfirmationSignal(normalizedContent),
  };
}

function makeActiveLoop(loopType, title, summary, confidence, ruleName, options = {}) {
  const normalizedTitle = cleanSnippet(title, 160);
  const normalizedSummary = cleanSnippet(summary || title, 220);
  const keywords = uniqueList((options.keywords || []).map((item) => cleanSnippet(item, 32)));

  return {
    loopType,
    title: normalizedTitle,
    summary: normalizedSummary,
    confidence,
    ruleName,
    dueHint: options.dueHint ? cleanSnippet(options.dueHint, 80) : '',
    keywords,
    canonicalKey: buildActiveLoopCanonicalKey(loopType, normalizedTitle),
  };
}

async function upsertSessionMemory({
  sessionId,
  userId,
  scope,
  summary,
  keyTopics,
  openLoops,
  lastMessageId,
  messageCount,
}) {
  await db.execute(
    `INSERT INTO session_memories (session_id, user_id, scope, summary, key_topics, open_loops, last_message_id, message_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       summary = VALUES(summary),
       key_topics = VALUES(key_topics),
       open_loops = VALUES(open_loops),
       last_message_id = VALUES(last_message_id),
       message_count = VALUES(message_count),
       updated_at = CURRENT_TIMESTAMP`,
    [
      sessionId,
      userId,
      scope,
      summary || '',
      JSON.stringify(keyTopics || []),
      JSON.stringify(openLoops || []),
      lastMessageId,
      messageCount || 0,
    ]
  );
}

async function upsertUserMemory({
  userId,
  sessionId,
  sourceMessageId,
  scope,
  memoryType,
  content,
  confidence,
  ruleName,
  canonicalKey,
  isUserConfirmed = false,
}) {
  const normalizedContent = normalizeMemoryContent(content);
  if (!normalizedContent) {
    return null;
  }

  const resolvedCanonicalKey = cleanSnippet(canonicalKey || buildCanonicalKey(memoryType, normalizedContent), 160);
  const [existingRows] = await db.execute(
    `SELECT id, content, confidence, status, times_seen, is_user_confirmed
     FROM user_memories
     WHERE user_id = ? AND scope = ? AND memory_type = ? AND canonical_key = ?
       AND status <> 'deleted'
     ORDER BY id DESC
     LIMIT 1`,
    [userId, scope, memoryType, resolvedCanonicalKey]
  );

  if (existingRows.length > 0) {
    const existing = existingRows[0];
    const nextTimesSeen = Number(existing.times_seen || 1) + 1;
    const nextConfirmed = Boolean(existing.is_user_confirmed) || isUserConfirmed || nextTimesSeen >= 2;
    const nextConfidence = resolveConfidence({
      currentConfidence: existing.confidence,
      incomingConfidence: confidence,
      timesSeen: nextTimesSeen,
      isUserConfirmed: nextConfirmed,
    });
    const nextContent = chooseMemoryContent(existing.content, normalizedContent);

    await db.execute(
      `UPDATE user_memories
       SET content = ?,
           confidence = ?,
           times_seen = ?,
           is_user_confirmed = ?,
           source_message_id = ?,
           source_session_id = ?,
           last_confirmed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        nextContent,
        nextConfidence,
        nextTimesSeen,
        nextConfirmed ? 1 : 0,
        sourceMessageId,
        sessionId,
        existing.id,
      ]
    );

    await logMemoryEvent({
      userId,
      sessionId,
      messageId: sourceMessageId,
      eventType: 'memory_updated',
      ruleName,
      beforeValue: JSON.stringify({
        content: existing.content,
        confidence: existing.confidence,
        timesSeen: existing.times_seen,
      }),
      afterValue: JSON.stringify({
        content: nextContent,
        confidence: nextConfidence,
        timesSeen: nextTimesSeen,
      }),
      payload: {
        memoryId: existing.id,
        scope,
        memoryType,
        canonicalKey: resolvedCanonicalKey,
      },
    });

    return {
      action: 'updated',
      memoryId: existing.id,
      scope,
      memoryType,
      canonicalKey: resolvedCanonicalKey,
    };
  }

  const initialConfirmed = isUserConfirmed;
  const initialConfidence = resolveConfidence({
    currentConfidence: 0,
    incomingConfidence: confidence,
    timesSeen: 1,
    isUserConfirmed: initialConfirmed,
  });

  const [result] = await db.execute(
    `INSERT INTO user_memories (
       user_id, scope, memory_type, content, canonical_key, confidence, status,
       times_seen, source_message_id, source_session_id, is_user_confirmed
     )
     VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
    [
      userId,
      scope,
      memoryType,
      normalizedContent,
      resolvedCanonicalKey,
      initialConfidence,
      sourceMessageId,
      sessionId,
      initialConfirmed ? 1 : 0,
    ]
  );

  await logMemoryEvent({
    userId,
    sessionId,
    messageId: sourceMessageId,
    eventType: 'memory_created',
    ruleName,
    afterValue: JSON.stringify({
      content: normalizedContent,
      confidence: initialConfidence,
    }),
    payload: {
      memoryId: result.insertId,
      scope,
      memoryType,
      canonicalKey: resolvedCanonicalKey,
    },
  });

  return {
    action: 'created',
    memoryId: result.insertId,
    scope,
    memoryType,
    canonicalKey: resolvedCanonicalKey,
  };
}

async function upsertActiveLoop({
  userId,
  sessionId,
  sourceMessageId,
  loopType,
  title,
  summary,
  confidence,
  ruleName,
  canonicalKey,
  dueHint = '',
  keywords = [],
}) {
  const normalizedTitle = normalizeMemoryContent(title);
  if (!normalizedTitle) {
    return null;
  }

  const normalizedSummary = normalizeMemoryContent(summary || title);
  const resolvedCanonicalKey = cleanSnippet(canonicalKey || buildActiveLoopCanonicalKey(loopType, normalizedTitle), 160);
  const [existingRows] = await db.execute(
    `SELECT id, title, summary, confidence, status, times_seen, due_hint, keywords
     FROM user_active_loops
     WHERE user_id = ? AND loop_type = ? AND canonical_key = ?
       AND status <> 'dismissed'
     ORDER BY id DESC
     LIMIT 1`,
    [userId, loopType, resolvedCanonicalKey]
  );

  const nextKeywords = uniqueList((keywords || []).map((item) => normalizeMemoryContent(item)).filter(Boolean)).slice(0, 6);

  if (existingRows.length > 0) {
    const existing = existingRows[0];
    const nextTimesSeen = Number(existing.times_seen || 1) + 1;
    const nextConfidence = Number(Math.min(Math.max(Number(existing.confidence || 0), Number(confidence || 0)) + 0.05, 0.98).toFixed(2));
    const mergedKeywords = uniqueList([
      ...safeParse(existing.keywords, []),
      ...nextKeywords,
    ]).slice(0, 6);

    await db.execute(
      `UPDATE user_active_loops
       SET title = ?,
           summary = ?,
           confidence = ?,
           status = 'active',
           times_seen = ?,
           source_message_id = ?,
           source_session_id = ?,
           due_hint = ?,
           keywords = ?,
           last_seen_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        chooseLoopTitle(existing.title, normalizedTitle),
        chooseLoopSummary(existing.summary, normalizedSummary),
        nextConfidence,
        nextTimesSeen,
        sourceMessageId,
        sessionId,
        dueHint || existing.due_hint || null,
        JSON.stringify(mergedKeywords),
        existing.id,
      ]
    );

    await logMemoryEvent({
      userId,
      sessionId,
      messageId: sourceMessageId,
      eventType: 'active_loop_updated',
      ruleName,
      beforeValue: JSON.stringify({
        title: existing.title,
        summary: existing.summary,
        confidence: existing.confidence,
        timesSeen: existing.times_seen,
      }),
      afterValue: JSON.stringify({
        title: chooseLoopTitle(existing.title, normalizedTitle),
        summary: chooseLoopSummary(existing.summary, normalizedSummary),
        confidence: nextConfidence,
        timesSeen: nextTimesSeen,
      }),
      payload: {
        loopId: existing.id,
        loopType,
        canonicalKey: resolvedCanonicalKey,
      },
    });

    return {
      action: 'updated',
      loopId: existing.id,
      loopType,
      canonicalKey: resolvedCanonicalKey,
    };
  }

  const [result] = await db.execute(
    `INSERT INTO user_active_loops (
       user_id, loop_type, title, summary, canonical_key, keywords, confidence, status,
       times_seen, source_message_id, source_session_id, due_hint
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
    [
      userId,
      loopType,
      normalizedTitle,
      normalizedSummary,
      resolvedCanonicalKey,
      JSON.stringify(nextKeywords),
      Number(Math.min(Math.max(Number(confidence || 0), 0.55), 0.98).toFixed(2)),
      sourceMessageId,
      sessionId,
      dueHint || null,
    ]
  );

  await logMemoryEvent({
    userId,
    sessionId,
    messageId: sourceMessageId,
    eventType: 'active_loop_created',
    ruleName,
    afterValue: JSON.stringify({
      title: normalizedTitle,
      summary: normalizedSummary,
      confidence,
    }),
    payload: {
      loopId: result.insertId,
      loopType,
      canonicalKey: resolvedCanonicalKey,
    },
  });

  return {
    action: 'created',
    loopId: result.insertId,
    loopType,
    canonicalKey: resolvedCanonicalKey,
  };
}

async function markMemoriesUsed(memoryIds) {
  if (!Array.isArray(memoryIds) || memoryIds.length === 0) return;
  const ids = uniqueList(memoryIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0));
  if (ids.length === 0) return;
  await db.execute(
    `UPDATE user_memories
     SET last_used_at = CURRENT_TIMESTAMP
     WHERE id IN (${ids.join(',')})`
  );
}

async function logMemoryEvent({
  userId,
  sessionId,
  messageId = null,
  eventType,
  ruleName = null,
  beforeValue = null,
  afterValue = null,
  payload = null,
}) {
  if (!sessionId) return;

  await db.execute(
    `INSERT INTO memory_events (user_id, session_id, message_id, event_type, rule_name, before_value, after_value, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      sessionId || 0,
      messageId,
      eventType,
      ruleName,
      beforeValue,
      afterValue,
      JSON.stringify(payload || {}),
    ]
  );
}

function getRoleScope(mode) {
  return SESSION_SCOPE_BY_MODE[mode] || 'classic_bias';
}

function rankUserMemory(row, mode, retrievalPlan = null, queryText = '') {
  const typeWeight = getMemoryTypeWeight(mode, row.memory_type);
  const confidence = Number.parseFloat(row.confidence || 0);
  const timesSeen = Number.parseInt(row.times_seen || 1, 10);
  const confirmedBoost = row.is_user_confirmed ? 10 : 0;
  const recencyBoost = computeRecencyBoost(row.updated_at, row.last_confirmed_at);
  const usedBoost = row.last_used_at ? 2 : 0;
  const intentBoost = getMemoryTypeIntentWeight(retrievalPlan?.intent, row.memory_type, mode);
  const overlapBoost = computeTextOverlapBoost(row.content, queryText);

  return confidence * 100 + typeWeight + timesSeen * 4 + confirmedBoost + recencyBoost + usedBoost + intentBoost + overlapBoost;
}

function getMemoryTypeWeight(mode, memoryType) {
  const weights = {
    classic: {
      support_style: 26,
      emotional_state: 24,
      trigger: 22,
      relationship: 16,
      preference: 10,
      goal: 8,
      problem_pattern: 6,
      action_history: 4,
    },
    direct: {
      problem_pattern: 28,
      action_history: 22,
      goal: 20,
      relationship: 12,
      trigger: 8,
      preference: 6,
      support_style: 2,
      emotional_state: 2,
    },
  };

  const modeKey = mode === 'direct' ? 'direct' : 'classic';
  return weights[modeKey][memoryType] || 0;
}

function rankActiveLoop(row, retrievalPlan = null, queryText = '') {
  const confidence = Number.parseFloat(row.confidence || 0);
  const timesSeen = Number.parseInt(row.times_seen || 1, 10);
  const recencyBoost = computeRecencyBoost(row.updated_at, row.last_seen_at, row.created_at);
  const loopTypeWeight = getLoopTypeIntentWeight(retrievalPlan?.intent, row.loop_type);
  const overlapBoost = computeTextOverlapBoost([row.title, row.summary, row.due_hint].filter(Boolean).join(' '), queryText);

  return confidence * 100 + timesSeen * 5 + recencyBoost + loopTypeWeight + overlapBoost;
}

function computeRecencyBoost(...dates) {
  const latest = dates
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0];

  if (!latest) return 0;
  const ageDays = (Date.now() - latest) / (24 * 60 * 60 * 1000);
  if (ageDays <= 3) return 8;
  if (ageDays <= 7) return 5;
  if (ageDays <= 30) return 2;
  return 0;
}

async function buildRetrievalPlan({ query = '', mode = 'classic', hasKnowledgeInput = false }) {
  const normalizedQuery = normalizeMemoryContent(query);

  // Hard gates: unambiguous intents that skip LLM
  if (hasKnowledgeInput || /(附件|文件|pdf|截图|照片|图片|链接|url|刚刚导入|这个文件|这个链接)/i.test(normalizedQuery)) {
    return {
      intent: 'file_or_url_followup', secondaryIntent: null, userStance: 'neutral', intentConfidence: 0.95,
      query: normalizedQuery, mode, hasKnowledgeInput: true, intentSource: 'hard_gate',
    };
  }
  if (/(你还记得|记不记得|记得吗|你知道我|之前说过|你记住了什么)/.test(normalizedQuery)) {
    return {
      intent: 'memory_audit', secondaryIntent: null, userStance: 'checking_memory', intentConfidence: 0.92,
      query: normalizedQuery, mode, hasKnowledgeInput: false, intentSource: 'hard_gate',
    };
  }

  // LLM classification with rule-based fallback
  const intentResult = await classifyIntentWithLLM(normalizedQuery, { mode });

  return {
    intent: intentResult.primary,
    secondaryIntent: intentResult.secondary,
    userStance: intentResult.stance,
    intentConfidence: intentResult.confidence,
    query: normalizedQuery,
    mode,
    hasKnowledgeInput: Boolean(hasKnowledgeInput),
    intentSource: intentResult.source,
  };
}

function buildRetrievalPlanSync({ query = '', mode = 'classic', hasKnowledgeInput = false }) {
  const normalizedQuery = normalizeMemoryContent(query);
  if (hasKnowledgeInput || /(附件|文件|pdf|截图|照片|图片|链接|url|刚刚导入|这个文件|这个链接)/i.test(normalizedQuery)) {
    return { intent: 'file_or_url_followup', secondaryIntent: null, userStance: 'neutral', intentConfidence: 0.95, query: normalizedQuery, mode, hasKnowledgeInput: true, intentSource: 'hard_gate' };
  }
  if (/(你还记得|记不记得|记得吗|你知道我|之前说过|你记住了什么)/.test(normalizedQuery)) {
    return { intent: 'memory_audit', secondaryIntent: null, userStance: 'checking_memory', intentConfidence: 0.92, query: normalizedQuery, mode, hasKnowledgeInput: false, intentSource: 'hard_gate' };
  }
  const result = detectRetrievalIntentByRules(normalizedQuery, { mode });
  return { intent: result.primary, secondaryIntent: result.secondary, userStance: result.stance, intentConfidence: result.confidence, query: normalizedQuery, mode, hasKnowledgeInput: Boolean(hasKnowledgeInput), intentSource: result.source || 'rules_sync' };
}

// ---------------------------------------------------------------------------
// LLM intent classification
// ---------------------------------------------------------------------------

const VALID_INTENTS = new Set([
  'schedule_logistics', 'sleep_recovery', 'relationship_conversation',
  'active_problem_solving', 'emotional_support', 'general_support',
]);
const VALID_STANCES = new Set(['venting', 'seeking_action', 'asking_fact', 'checking_memory', 'neutral']);

const INTENT_CLASSIFIER_PROMPT = `你是一个意图分类器。根据用户输入，返回 JSON：
{
  "primary": "主意图",
  "secondary": "副意图或null",
  "stance": "用户姿态",
  "confidence": 0.0到1.0
}

可选 primary/secondary（选最相关的）：
- schedule_logistics：日程、安排、时间相关
- sleep_recovery：睡眠问题（失眠、早醒、睡不着）
- relationship_conversation：涉及具体人际关系的困扰或沟通
- active_problem_solving：用户在求具体方案或下一步行动
- emotional_support：情绪倾诉、心理困扰
- general_support：以上都不明确时

stance（用户当前姿态）：
- venting：在倾诉/吐槽，不在求解
- seeking_action：明确要求给行动/方案/话术
- asking_fact：请求知识/信息/定义
- neutral：无明确姿态

规则：
1. secondary 只在用户明确混合两个不同意图时才给，否则 null
2. 单纯提到人名或称谓不算 relationship_conversation，必须涉及关系互动或沟通困扰
3. 带情绪词的知识请求（如"焦虑的论文"）stance 是 asking_fact，不是 emotional_support
4. confidence 反映你的确定程度，混合/模糊场景给低值

只返回 JSON，不要其他文字。`;

async function classifyIntentWithLLM(query, { mode = 'classic' } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ...detectRetrievalIntentByRules(query, { mode }), source: 'rules_no_key' };
  }

  try {
    const endpoint = `${OPENAI_BASE_URL}/chat/completions`;
    const response = await axios.post(
      endpoint,
      {
        model: INTENT_CLASSIFIER_MODEL,
        messages: [
          { role: 'system', content: INTENT_CLASSIFIER_PROMPT },
          { role: 'user', content: query },
        ],
        temperature: 0.05,
        max_tokens: 120,
        response_format: { type: 'json_object' },
      },
      {
        timeout: INTENT_CLASSIFIER_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        ...buildIntentProxyConfig(endpoint),
      }
    );

    const raw = response.data?.choices?.[0]?.message?.content || '{}';
    const parsed = safeParseJSON(raw);

    if (!parsed || typeof parsed.primary !== 'string') {
      console.warn('[IntentClassifier] Invalid LLM response, falling back to rules:', raw);
      return { ...detectRetrievalIntentByRules(query, { mode }), source: 'rules_invalid_llm' };
    }

    // Normalize LLM output: map non-standard intents and ensure valid values
    const normPrimary = normalizeIntentValue(parsed.primary);
    const normSecondary = normalizeIntentValue(parsed.secondary);

    // If LLM returned an unrecognizable primary intent, fall back to rules entirely
    if (!normPrimary) {
      console.warn(`[IntentClassifier] unrecognized LLM primary "${parsed.primary}", falling back to rules`);
      const fallback = { ...detectRetrievalIntentByRules(query, { mode }), source: 'rules_invalid_llm' };
      console.info(`[IntentClassifier] ${fallback.source} | intent=${fallback.primary} secondary=${fallback.secondary || '-'} stance=${fallback.stance} conf=${fallback.confidence}`);
      return fallback;
    }

    const normStance = VALID_STANCES.has(parsed.stance) ? parsed.stance
      : VALID_STANCES.has(parsed.primary) ? parsed.primary  // LLM sometimes puts stance-like values in primary
        : 'neutral';

    if (normPrimary !== parsed.primary || (parsed.secondary && normSecondary !== parsed.secondary)) {
      console.info(`[IntentClassifier] normalized: ${parsed.primary}→${normPrimary}, ${parsed.secondary || '-'}→${normSecondary || '-'}`);
    }

    const result = {
      primary: normPrimary,
      secondary: normSecondary !== normPrimary ? normSecondary : null,
      stance: normStance,
      confidence: typeof parsed.confidence === 'number' ? Math.min(parsed.confidence, 0.98) : 0.8,
      source: 'llm',
    };
    console.info(`[IntentClassifier] ${result.source} | intent=${result.primary} secondary=${result.secondary || '-'} stance=${result.stance} conf=${result.confidence}`);
    return result;
  } catch (error) {
    const isTimeout = error?.code === 'ECONNABORTED' || String(error?.message || '').includes('timeout');
    const fallbackSource = isTimeout ? 'rules_timeout' : 'rules_error';
    const fallback = { ...detectRetrievalIntentByRules(query, { mode }), source: fallbackSource };
    console.warn(`[IntentClassifier] LLM ${isTimeout ? 'timeout' : 'error'}, falling back to rules:`, error?.message || '');
    console.info(`[IntentClassifier] ${fallback.source} | intent=${fallback.primary} secondary=${fallback.secondary || '-'} stance=${fallback.stance} conf=${fallback.confidence}`);
    return fallback;
  }
}

function normalizeIntentValue(value) {
  if (!value || typeof value !== 'string') return null;
  if (VALID_INTENTS.has(value)) return value;
  // LLM sometimes returns stance-like values as intents
  const INTENT_ALIASES = {
    asking_fact: 'general_support',
    knowledge_request: 'general_support',
    venting: 'emotional_support',
    checking_memory: 'memory_audit',
  };
  return INTENT_ALIASES[value] || null;
}

function safeParseJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function buildIntentProxyConfig(targetUrl) {
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

// ---------------------------------------------------------------------------
// Rule-based fallback (used when LLM unavailable/timeout/error)
// ---------------------------------------------------------------------------

function detectRetrievalIntentByRules(query, { mode = 'classic' } = {}) {
  // Knowledge requests take priority over emotion-word matching
  if (/(论文|研究|文献|paper|study|摘要|资料|报告|定义|解释一下|科普一下|什么意思|(?:^|[，。？\s])[\u4e00-\u9fff]{1,4}是什么)/.test(query)) {
    return { primary: 'general_support', secondary: null, stance: 'asking_fact', confidence: 0.8 };
  }
  if (/(几点|日程|安排|会议|calendar|schedule)/i.test(query)
    || (/(今天|明天|后天|这周|下周|周[一二三四五六日天])/i.test(query)
      && /(要|去|约|安排|复诊|面试|汇报|考试|沟通|开会|见面|回访|约谈)/.test(query))) {
    return { primary: 'schedule_logistics', secondary: null, stance: 'neutral', confidence: 0.85 };
  }
  if (/(失眠|睡不着|睡不好|早醒|睡不回去|凌晨.*醒)/.test(query)) {
    const hasRelational = /(妈妈|爸爸|父母|伴侣|老婆|老公|老板|吵架|冷战|关系)/.test(query);
    return {
      primary: 'sleep_recovery',
      secondary: hasRelational ? 'relationship_conversation' : null,
      stance: /(怎么办|怎么做|下一步)/.test(query) ? 'seeking_action' : 'neutral',
      confidence: 0.8,
    };
  }
  if (/(沟通|开口|吵架|冷战|紧绷|边界|愧疚|被消耗)/.test(query)
    && /(妈妈|爸爸|父母|伴侣|老婆|老公|老板|同事|家里人|朋友|导师|老师)/.test(query)) {
    return {
      primary: 'relationship_conversation',
      secondary: /(焦虑|难过|低落|压抑|崩溃|撑不住)/.test(query) ? 'emotional_support' : null,
      stance: /(怎么开口|怎么说|怎么办|怎么做|不知道怎么谈)/.test(query) ? 'seeking_action'
        : /(压抑|难受|受不了|烦|累|委屈|就是.*说说|吐槽)/.test(query) ? 'venting' : 'neutral',
      confidence: 0.8,
    };
  }
  if (/(怎么办|怎么做|下一步|帮我梳理|给我结论|说重点|先做什么)/.test(query) || mode === 'direct') {
    return { primary: 'active_problem_solving', secondary: null, stance: 'seeking_action', confidence: 0.8 };
  }
  if (/(崩溃|撑不住|受不了|焦虑|难过|低落|委屈|压力|害怕|压抑)/.test(query)) {
    const isVenting = /(就是.*吐槽|随便说说|说不上来|别分析|陪我说)/.test(query);
    return { primary: 'emotional_support', secondary: null, stance: isVenting ? 'venting' : 'neutral', confidence: 0.7 };
  }
  // general fallback
  const stance = /(论文|研究|文献|摘要|定义|解释一下|科普)/.test(query) ? 'asking_fact'
    : /(就是.*吐槽|随便说说|说不上来|别分析|陪我说|别说那么多)/.test(query) ? 'venting'
      : /(别安慰|直接说|怎么办)/.test(query) ? 'seeking_action'
        : 'neutral';
  return { primary: 'general_support', secondary: null, stance, confidence: 0.4 };
}

// Keep old function name for __test export compatibility
function detectRetrievalIntent(query, opts = {}) {
  if (opts.hasKnowledgeInput || /(附件|文件|pdf|截图|照片|图片|链接|url|刚刚导入|这个文件|这个链接)/i.test(query)) {
    return { primary: 'file_or_url_followup', secondary: null, stance: 'neutral', confidence: 0.95 };
  }
  if (/(你还记得|记不记得|记得吗|你知道我|之前说过|你记住了什么)/.test(query)) {
    return { primary: 'memory_audit', secondary: null, stance: 'checking_memory', confidence: 0.92 };
  }
  return detectRetrievalIntentByRules(query, opts);
}

function getMemoryTypeIntentWeight(intent = 'general_support', memoryType, mode) {
  const weightByIntent = {
    emotional_support: {
      support_style: 18,
      emotional_state: 18,
      trigger: 12,
      relationship: 8,
    },
    active_problem_solving: {
      goal: 16,
      problem_pattern: 18,
      action_history: 16,
      preference: 4,
    },
    relationship_conversation: {
      relationship: 18,
      support_style: 12,
      trigger: 10,
      emotional_state: 8,
    },
    sleep_recovery: {
      emotional_state: 12,
      trigger: 10,
      preference: 4,
    },
    schedule_logistics: {
      goal: 10,
      action_history: 6,
    },
    memory_audit: {
      goal: 10,
      relationship: 10,
      trigger: 8,
      support_style: 8,
      problem_pattern: 8,
      action_history: 8,
      emotional_state: 8,
    },
    file_or_url_followup: {
      goal: -4,
      relationship: -2,
      support_style: -4,
      emotional_state: -4,
      trigger: -2,
      problem_pattern: -4,
      action_history: -4,
    },
  };

  const intentWeights = weightByIntent[intent] || {};
  const modeAdjustment = intent === 'active_problem_solving' && mode === 'direct' && memoryType === 'problem_pattern'
    ? 6
    : 0;

  return (intentWeights[memoryType] || 0) + modeAdjustment;
}

function getLoopTypeIntentWeight(intent = 'general_support', loopType) {
  const weightByIntent = {
    emotional_support: {
      emotional_cycle: 16,
      sleep_recovery: 10,
      difficult_conversation: 8,
    },
    active_problem_solving: {
      goal_process: 18,
      difficult_conversation: 16,
      upcoming_commitment: 14,
    },
    relationship_conversation: {
      difficult_conversation: 22,
      emotional_cycle: 8,
    },
    sleep_recovery: {
      sleep_recovery: 24,
      emotional_cycle: 8,
    },
    schedule_logistics: {
      upcoming_commitment: 24,
      goal_process: 8,
    },
    memory_audit: {
      goal_process: 12,
      difficult_conversation: 12,
      sleep_recovery: 8,
      upcoming_commitment: 8,
      emotional_cycle: 8,
    },
    file_or_url_followup: {
      goal_process: -6,
      difficult_conversation: -6,
      sleep_recovery: -6,
      upcoming_commitment: -4,
      emotional_cycle: -6,
    },
  };

  return (weightByIntent[intent] || {})[loopType] || 0;
}

function resolveSelectedMemoryLimit(intent = 'general_support', fallbackLimit) {
  const limits = {
    file_or_url_followup: Math.min(fallbackLimit, 2),
    schedule_logistics: Math.min(fallbackLimit, 3),
    memory_audit: Math.min(fallbackLimit, 8),
    emotional_support: Math.min(fallbackLimit, 10),
    relationship_conversation: Math.min(fallbackLimit, 10),
    general_support: Math.min(fallbackLimit, 2),
  };

  return limits[intent] || fallbackLimit;
}

function resolveSelectedActiveLoopLimit(intent = 'general_support', fallbackLimit) {
  const limits = {
    file_or_url_followup: 0,
    schedule_logistics: Math.min(fallbackLimit, 2),
    emotional_support: Math.min(fallbackLimit, 3),
    general_support: Math.min(fallbackLimit, 2),
  };

  return limits[intent] ?? Math.min(fallbackLimit, 4);
}

function computeTextOverlapBoost(sourceText, queryText) {
  const source = normalizeMemoryContent(sourceText);
  const query = normalizeMemoryContent(queryText);
  if (!source || !query) return 0;

  const queryTerms = extractRetrievalTerms(query);
  if (queryTerms.length === 0) return 0;

  return queryTerms.reduce((score, term) => {
    if (!term) return score;
    if (source.includes(term)) return score + Math.min(term.length * 2, 10);
    return score;
  }, 0);
}

function collectTopics(messages) {
  const topicCounts = new Map();
  messages.forEach((message) => {
    const analysis = message.analysis || engine.analyzeText(message.content);
    (analysis?.topics || []).forEach((topic) => {
      const key = String(topic).trim();
      if (!key) return;
      topicCounts.set(key, (topicCounts.get(key) || 0) + 1);
    });
  });
  return [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);
}

function collectOpenLoops(messages) {
  return messages
    .filter((message) => message.role === 'user' && /[？?]$/.test(message.content.trim()))
    .slice(-3)
    .map((message) => cleanSnippet(message.content, 72));
}

function collectEmotionTrend(messages) {
  const emotionCounts = new Map();
  messages.forEach((message) => {
    const analysis = message.analysis || engine.analyzeText(message.content);
    const emotion = analysis?.dominantEmotion;
    if (!emotion || emotion === 'neutral') return;
    emotionCounts.set(emotion, (emotionCounts.get(emotion) || 0) + 1);
  });
  if (emotionCounts.size === 0) return '';
  return [...emotionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([emotion]) => translateEmotion(emotion))
    .join('、');
}

function translateEmotion(emotion) {
  const map = {
    anxiety: '焦虑',
    sadness: '低落',
    anger: '愤怒',
    joy: '轻松',
    stress: '压力',
    calm: '平静',
  };
  return map[emotion] || emotion;
}

function getSentenceIgnoreReason(text) {
  if (!text) return 'empty';
  if (isQuestionLike(text)) return 'question_like';
  if (isHypothetical(text)) return 'hypothetical';
  if (isPureQuote(text)) return 'quoted_only';
  if (isReportedSpeech(text)) return 'reported_speech';
  if (isAttributedOrDisownedQuote(text)) return 'quoted_attribution';
  return '';
}

function detectGoal(text) {
  if (isReportedSpeech(text)) return '';

  const explicitGoal = text.match(/(?:我想|我希望|我打算|我的目标是|我准备)(.{2,40})/);
  if (explicitGoal) {
    return `用户想要${trimMemoryFragment(explicitGoal[1])}`;
  }

  const ongoingGoal = text.match(/(?:我最近在准备|我现在在准备|我正在准备)(.{2,40})/);
  if (ongoingGoal) {
    return `用户最近在准备${trimMemoryFragment(ongoingGoal[1])}`;
  }

  return '';
}

function detectPreference(text) {
  if (isReportedSpeech(text)) return '';
  const match = text.match(/(?:我喜欢|我不喜欢|我更喜欢|我更希望|我习惯)(.{2,40})/);
  return match ? `用户偏好${trimMemoryFragment(match[1], { keepClauses: true })}` : '';
}

function detectRelationship(text) {
  if (isReportedSpeech(text)) return '';
  const relationshipWords = ['妈妈', '爸爸', '父母', '伴侣', '男朋友', '女朋友', '老婆', '老公', '孩子', '朋友', '同事', '老板', '导师', '老师'];
  const word = relationshipWords.find((item) => text.includes(item));
  if (!word) return '';
  return cleanSnippet(`用户反复提到与${word}有关的关系议题：${text}`, 100);
}

function detectSupportPreference(text) {
  if (/直接一点|别绕|说重点|给我结论|别安慰我/.test(text)) {
    return '用户希望回复更直接、少铺垫';
  }
  if (/先陪我|先安慰|抱抱我|听我说|别急着给建议/.test(text)) {
    return '用户更需要先被接住，再进入建议';
  }
  if (/多问我|你可以问我|慢一点/.test(text)) {
    return '用户更接受被追问和慢节奏澄清';
  }
  return '';
}

function detectTriggerSentence(text) {
  const match = text.match(/(?:每次|一到|一想到|只要)(.{2,32})(?:就|都会|都)(.{2,32})/);
  if (!match) return '';
  return cleanSnippet(`用户容易在${match[1].trim()}时出现${match[2].trim()}`, 90);
}

function detectRecurringPattern(text) {
  if (isReportedSpeech(text) || isPureQuote(text)) return '';
  const match = text.match(/(?:我总是|我一直|我老是|我反复|(?:^|[，,；;、]\s*)总是|(?:^|[，,；;、]\s*)一直|(?:^|[，,；;、]\s*)老是|(?:^|[，,；;、]\s*)反复)(.{4,40})/);
  return match ? cleanSnippet(`用户反复出现的模式：${trimMemoryFragment(match[1])}`, 90) : '';
}

function detectActionHistory(text) {
  const match = text.match(/(?:我试过|我已经|我之前有|我后来)(.{4,40})/);
  return match ? cleanSnippet(`用户已经尝试过${match[1].trim()}`, 90) : '';
}

function detectStableEmotionalState(text, analysis) {
  const stableMarker = /(最近一直|这阵子一直|长期|反复|总是|老是|一直都|每晚|总会)/;
  const emotionMarker = /(焦虑|紧张|低落|难过|委屈|愤怒|压抑|压力很大|失眠|撑不住|害怕|恐慌)/;
  if (!stableMarker.test(text) || !emotionMarker.test(text)) return '';
  const match = text.match(emotionMarker);
  const emotion = match?.[1] || translateEmotion(analysis?.dominantEmotion || '');
  if (!emotion) return '';
  return cleanSnippet(`用户近期持续承受${emotion}相关的情绪负荷`, 90);
}

function detectGoalProcessLoop(text) {
  const match = text.match(/(?:我最近在准备|我现在在准备|我正在准备)(.{2,30})/);
  if (!match) return null;
  const fragment = trimMemoryFragment(match[1]);
  if (!fragment) return null;
  return makeActiveLoop(
    'goal_process',
    `准备${fragment}`,
    `用户最近在持续推进：准备${fragment}`,
    0.82,
    'goal_process_loop',
    { keywords: [fragment, '准备'] }
  );
}

function detectDifficultConversationLoop(text) {
  if (isReportedSpeech(text)) return null;
  const relationship = extractRelationshipEntity(text);
  const match = text.match(/(?:卡在|不知道怎么|不敢|还没|一直没)(?:跟|和)?(.{1,10}?)(?:开口|说|沟通|聊)/);
  const target = relationship || trimMemoryFragment(match?.[1] || '', { keepClauses: true });
  if (!target) return null;
  if (!/(开口|沟通|聊|说)/.test(text)) return null;
  return makeActiveLoop(
    'difficult_conversation',
    `和${target}开口`,
    `用户目前还卡在如何跟${target}开口或沟通`,
    0.86,
    'difficult_conversation_loop',
    { keywords: [target, '沟通', '开口'] }
  );
}

function detectSleepRecoveryLoop(text) {
  if (!/(失眠|睡不着|睡不好|早醒|熬夜|睡眠)/.test(text)) return null;
  if (!/(最近|这阵子|一直|反复|总是|每晚)/.test(text)) return null;
  return makeActiveLoop(
    'sleep_recovery',
    '睡眠恢复',
    '用户最近持续受睡眠问题影响，仍处在恢复或调整阶段',
    0.8,
    'sleep_recovery_loop',
    { keywords: ['睡眠', '恢复', '失眠'] }
  );
}

function detectUpcomingCommitmentLoop(text) {
  const timeMatch = text.match(/(今天|明天|后天|这周|下周|周[一二三四五六日天]|本周)/);
  const eventMatch = text.match(/(复诊|面试|汇报|考试|沟通|开会|见面|回访|约谈)/);
  if (!timeMatch || !eventMatch) return null;
  return makeActiveLoop(
    'upcoming_commitment',
    `${timeMatch[1]}${eventMatch[1]}`,
    `用户最近有一个临近事项：${timeMatch[1]}${eventMatch[1]}`,
    0.76,
    'upcoming_commitment_loop',
    { keywords: [timeMatch[1], eventMatch[1]], dueHint: timeMatch[1] }
  );
}

function detectEmotionalCycleLoop(text, analysis) {
  const emotionMatch = text.match(/(焦虑|低落|压力很大|害怕|拖延|压抑|委屈|崩溃|紧张)/);
  if (!emotionMatch) return null;
  if (!/(最近|这阵子|一直|反复|总是|老是|每次)/.test(text)) return null;
  if (!/(反复想|想最坏|停不下来|内耗|循环|拉扯|拖延|一遍遍|脑子停不下来)/.test(text)) return null;
  const emotion = emotionMatch[1] || translateEmotion(analysis?.dominantEmotion || '');
  if (!emotion) return null;
  return makeActiveLoop(
    'emotional_cycle',
    `${emotion}循环`,
    `用户最近持续被${emotion}相关状态反复拉扯`,
    0.72,
    'emotional_cycle_loop',
    { keywords: [emotion] }
  );
}

function splitSentences(text) {
  return String(text || '')
    .split(/[\n。！？!?；;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isQuestionLike(text) {
  const normalized = normalizeMemoryContent(text);
  if (/[?？]/.test(normalized)) return true;
  if (/(吗|呢|么)$/.test(normalized)) return true;
  return /^(什么|为什么|怎么|谁|是不是|是否|你还记得|记不记得|还记得|能不能|可不可以|要不要)/.test(normalized);
}

function isHypothetical(text) {
  return /(?:如果|假如|万一|要是|假设|设想|倘若)/.test(text);
}

function isPureQuote(text) {
  return /^[“"「『].+[”"」』]$/.test(text);
}

function isReportedSpeech(text) {
  return /(?:^|[，,；;、]\s*)(?:我)?(?:别人|朋友|妈妈|爸爸|老师|同事|老板|他|她)说/.test(text);
}

function isAttributedOrDisownedQuote(text) {
  return (
    /[“"「『].+[”"」』].*(?:这句话|那句话).*(?:别人|朋友|妈妈|爸爸|老师|同事|老板|他|她)说/.test(text)
    || /(?:不是我(?:现在)?的想法|不是我说的|不是我的想法)/.test(text)
  );
}

function detectUserConfirmationSignal(text) {
  return /(?:一直|长期|反复|总是|确实|就是|从小|每次)/.test(text);
}

function buildCanonicalKey(memoryType, content) {
  const normalized = normalizeMemoryContent(content)
    .replace(/\bpm\b/gi, '产品经理')
    .replace(/[“”"']/g, '')
    .replace(/[，,。.！!？?；;]+/g, '')
    .replace(/\s+/g, '');

  const cleanedByType = {
    goal: normalized.replace(/^用户(?:想要|最近在准备|正在准备|准备|目标是)/, ''),
    preference: normalized.replace(/^用户偏好/, ''),
    relationship: extractRelationshipEntity(normalized) || normalized.replace(/^用户反复提到与/, '').replace(/有关的关系议题：.*/, ''),
    trigger: normalized.replace(/^用户容易在/, '').replace(/时出现/, '->'),
    support_style: normalized.replace(/^用户/, ''),
    emotional_state: normalized.replace(/^用户近期持续承受/, ''),
    problem_pattern: normalized.replace(/^用户反复出现的模式：/, ''),
    action_history: normalized.replace(/^用户已经尝试过/, ''),
  };

  const core = cleanedByType[memoryType] || normalized;
  return cleanSnippet(`${memoryType}:${core}`, 160);
}

function buildActiveLoopCanonicalKey(loopType, title) {
  const normalized = normalizeMemoryContent(title)
    .replace(/[“”"']/g, '')
    .replace(/[，,。.！!？?；;]+/g, '')
    .replace(/\s+/g, '');

  return cleanSnippet(`${loopType}:${normalized}`, 160);
}

function extractRelationshipEntity(text) {
  const relationshipWords = ['妈妈', '爸爸', '父母', '伴侣', '男朋友', '女朋友', '老婆', '老公', '孩子', '朋友', '同事', '老板', '导师', '老师'];
  return relationshipWords.find((item) => text.includes(item)) || '';
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate.content) return false;
    const key = [candidate.scope, candidate.memoryType, candidate.canonicalKey].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeActiveLoopCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate?.title) return false;
    const key = [candidate.loopType, candidate.canonicalKey].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveConfidence({ currentConfidence, incomingConfidence, timesSeen, isUserConfirmed }) {
  const base = Math.max(Number(currentConfidence || 0), Number(incomingConfidence || 0));
  const repetitionBoost = Math.min(Math.max(timesSeen - 1, 0) * 0.05, 0.18);
  const confirmationBoost = isUserConfirmed ? 0.08 : 0;
  return Number(Math.min(base + repetitionBoost + confirmationBoost, 0.98).toFixed(2));
}

function chooseMemoryContent(existingContent, nextContent) {
  const existing = normalizeMemoryContent(existingContent);
  const incoming = normalizeMemoryContent(nextContent);
  if (!existing) return incoming;
  if (incoming.length > existing.length && incoming.includes(existing.replace(/^用户/, ''))) {
    return incoming;
  }
  return existing;
}

function chooseLoopTitle(existingTitle, nextTitle) {
  const existing = normalizeMemoryContent(existingTitle);
  const incoming = normalizeMemoryContent(nextTitle);
  if (!existing) return incoming;
  if (incoming.length > existing.length) return incoming;
  return existing;
}

function chooseLoopSummary(existingSummary, nextSummary) {
  const existing = normalizeMemoryContent(existingSummary);
  const incoming = normalizeMemoryContent(nextSummary);
  if (!existing) return incoming;
  if (incoming.length > existing.length && !existing.includes(incoming)) return incoming;
  return existing;
}

function mapUserMemoryRow(row) {
  return {
    id: row.id,
    scope: row.scope,
    memoryType: row.memory_type,
    content: row.content,
    canonicalKey: row.canonical_key,
    confidence: Number.parseFloat(row.confidence || 0),
    status: row.status,
    timesSeen: Number.parseInt(row.times_seen || 1, 10),
    isUserConfirmed: Boolean(row.is_user_confirmed),
    sourceMessageId: row.source_message_id || null,
    sourceSessionId: row.source_session_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    lastUsedAt: row.last_used_at || null,
    lastConfirmedAt: row.last_confirmed_at || null,
  };
}

function mapUserActiveLoopRow(row) {
  return {
    id: row.id,
    loopType: row.loop_type,
    title: row.title,
    summary: row.summary,
    canonicalKey: row.canonical_key,
    keywords: safeParse(row.keywords, []),
    confidence: Number.parseFloat(row.confidence || 0),
    status: row.status,
    timesSeen: Number.parseInt(row.times_seen || 1, 10),
    sourceMessageId: row.source_message_id || null,
    sourceSessionId: row.source_session_id || null,
    dueHint: row.due_hint || '',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    lastSeenAt: row.last_seen_at || null,
  };
}

async function ensureColumn(tableName, columnName, alterSql) {
  const [rows] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
  if (rows.length === 0) {
    await db.query(alterSql);
  }
}

function uniqueList(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractRetrievalTerms(text) {
  const keywords = [
    '妈妈', '爸爸', '父母', '伴侣', '男朋友', '女朋友', '老婆', '老公', '朋友', '同事', '老板', '导师', '老师',
    '沟通', '开口', '睡眠', '失眠', '恢复', '工作', '求职', '转岗', '面试', '复诊', '会议', '计划', '安排',
    '焦虑', '低落', '压力', '拖延', '关系', '家庭', '目标', '准备',
  ];

  return uniqueList(keywords.filter((keyword) => text.includes(keyword)));
}

function normalizeMemoryContent(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[：:]+/g, '：')
    .trim();
}

function trimMemoryFragment(text, options = {}) {
  const { keepClauses = false } = options;
  const normalized = normalizeMemoryContent(text)
    .replace(/^(?:要|会|想要|想去|想跟)\s*/, '')
    .trim();

  if (keepClauses) {
    return normalized
      .split(/[。！？!?]/)[0]
      .trim();
  }

  return normalized
    .split(/(?:，|,|；|;|但是|但|不过|只是|可是|然而|同时|另外|然后|也总是|也一直)/)[0]
    .trim();
}

function cleanSnippet(text, maxLength) {
  const normalized = normalizeMemoryContent(text);
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function clampPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

module.exports = {
  ensureMemorySchema,
  buildConversationContext,
  buildConversationContextDebug,
  getSessionDebugSnapshot,
  listUserMemories,
  listUserActiveLoops,
  rebuildSessionMemories,
  reextractUserMemories,
  updateUserMemoryStatus,
  updateUserActiveLoopStatus,
  captureTurn,
  __test: {
    detectRetrievalIntent,
    buildRetrievalPlan,
  },
};
