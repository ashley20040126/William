const db = require('../utils/db');
const engine = require('./behaviorEngine');
const ai = require('./ai');
const memory = require('./memoryService');
const attachmentService = require('./attachmentService');
const scheduleCandidateService = require('./scheduleCandidateService');
const { composePromptContext } = require('./prompting/composePromptContext');
const interventionService = require('./interventionService');
const { buildPracticeSuggestionsFromAssistantReply } = require('./userWellbeingService');
const { ensureChatSchema } = require('./chatSchemaService');

const EXPLICIT_SCHEDULE_REQUEST_PATTERN = /(帮我|帮忙|请|麻烦)?(把|将)?(.{0,8})?(加入|加到|加进|添加到|放进|放入|记到|安排到|排进|排到|纳入)(日程|行程|计划|calendar)|(帮我|帮忙|请|麻烦).{0,12}(制定|规划|安排|生成).{0,8}(日程|计划|行程)|设(一个)?提醒/;
const WELLNESS_CONTEXT_PATTERN = /(心理康复|心情|压力|焦虑|放松|冥想|散步|深呼吸|呼吸练习|瑜伽|正念|wellness|recovery|身心|舒缓|减压|情绪调节|心理恢复|心理调节|康复计划|恢复计划)/;

async function processChatTurn({
  userId,
  content,
  sessionKey,
  attachments = [],
  uploadedFiles = [],
  importedUrl = '',
  analysis = null,
  temporaryChat = false,
}) {
  await ensureChatSchema();
  const normalizedContent = (content || '').trim();
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  const normalizedFiles = Array.isArray(uploadedFiles) ? uploadedFiles : [];
  const normalizedImportedUrl = String(importedUrl || '').trim();

  if (!normalizedContent && normalizedAttachments.length === 0 && normalizedFiles.length === 0 && !normalizedImportedUrl) {
    throw new Error('Message or files required');
  }

  const resolvedSessionKey = (sessionKey || `session_${new Date().toISOString().split('T')[0]}`).trim();

  // Migration: ensure voice_id exists on chat_messages
  try {
    await db.execute('ALTER TABLE chat_messages ADD COLUMN voice_id VARCHAR(20) DEFAULT NULL');
  } catch (e) {
    // Already exists
  }

  const [userResult, sessionResult] = await Promise.all([
    db.execute('SELECT * FROM users WHERE id = ?', [userId]),
    db.execute('SELECT id, is_temporary FROM chat_sessions WHERE user_id = ? AND session_key = ?', [userId, resolvedSessionKey]),
  ]);

  const user = userResult[0][0];
  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  let sessionDbId = sessionResult[0][0]?.id;
  let sessionIsTemporary = Boolean(Number(sessionResult[0][0]?.is_temporary || 0));
  if (!sessionDbId) {
    const [created] = await db.execute(
      'INSERT INTO chat_sessions (user_id, session_key, is_temporary) VALUES (?, ?, ?)',
      [userId, resolvedSessionKey, temporaryChat ? 1 : 0]
    );
    sessionDbId = created.insertId;
    sessionIsTemporary = temporaryChat;
  }
  const memoryEnabled = user.memory_enabled == null ? true : Boolean(Number(user.memory_enabled));
  const disablePersistentMemory = Boolean(temporaryChat || sessionIsTemporary || !memoryEnabled);

  const initialDisplayContent = normalizedContent || (
    normalizedImportedUrl
      ? 'Shared AI Chat link'
      : normalizedFiles.length > 0
      ? 'Shared attachments'
      : normalizedAttachments.length > 0
        ? `[Shared ${normalizedAttachments.length} file(s)]`
        : ''
  );

  const currentVoiceMode = user.voice_mode || 'classic';

  const [userMessageResult] = await db.execute(
    'INSERT INTO chat_messages (session_id, user_id, role, content, attachments, analysis, voice_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      sessionDbId,
      userId,
      'user',
      initialDisplayContent,
      JSON.stringify(normalizedAttachments),
      null,
      currentVoiceMode,
    ]
  );
  const userMessageId = userMessageResult.insertId;

  let resolvedAttachments = normalizedAttachments;
  let currentAttachmentContext = '';
  let attachmentMemoryText = '';
  let attachmentAnalysisText = '';
  let attachmentDisplayText = '';

  if (normalizedFiles.length > 0) {
    const attachmentResult = await attachmentService.processUploadedFiles({
      userId,
      sessionId: sessionDbId,
      messageId: userMessageId,
      files: normalizedFiles,
    });
    resolvedAttachments = attachmentResult.attachments;
    currentAttachmentContext = attachmentResult.contextText;
    attachmentMemoryText = attachmentResult.memoryText;
    attachmentAnalysisText = attachmentResult.analysisText;
    attachmentDisplayText = attachmentResult.displayText;
  }

  if (normalizedImportedUrl) {
    const urlImportResult = await attachmentService.processImportedLink({
      userId,
      sessionId: sessionDbId,
      messageId: userMessageId,
      url: normalizedImportedUrl,
    });
    resolvedAttachments = [...resolvedAttachments, ...urlImportResult.attachments];
    currentAttachmentContext = [currentAttachmentContext, urlImportResult.contextText].filter(Boolean).join('\n\n');
    attachmentMemoryText = [attachmentMemoryText, urlImportResult.memoryText].filter(Boolean).join('\n');
    attachmentAnalysisText = [attachmentAnalysisText, urlImportResult.analysisText].filter(Boolean).join('\n');
    attachmentDisplayText = attachmentDisplayText || urlImportResult.displayText;
  }

  const displayContent = normalizedContent || attachmentDisplayText || initialDisplayContent;
  const analysisContent = [normalizedContent, attachmentAnalysisText].filter(Boolean).join('\n');
  const memoryInput = [normalizedContent, attachmentMemoryText].filter(Boolean).join('\n');
  const textAnalysis = analysis || engine.analyzeText(analysisContent || displayContent) || {
    stressEstimate: 5,
    dominantEmotion: 'neutral',
    cognitivePatterns: [],
    wordCount: 0,
  };

  await db.execute(
    `UPDATE chat_messages
     SET content = ?, attachments = ?, analysis = ?
     WHERE id = ?`,
    [
      displayContent,
      JSON.stringify(resolvedAttachments),
      JSON.stringify(textAnalysis),
      userMessageId,
    ]
  );

  if (!disablePersistentMemory) {
    interventionService.captureChatFollowupSignals({
      userId,
      sessionId: sessionDbId,
      userContent: normalizedContent || displayContent,
    }).catch((error) => {
      console.error('[ChatService] Intervention followup capture error:', error.message);
    });
  }

  let scheduleCandidates = [];
  let scheduleResolution = { source: 'none', combinedContent: normalizedContent };
  if (normalizedContent) {
    try {
      const previousUserContent = await findPreviousUserMessageContent({
        sessionId: sessionDbId,
        currentMessageId: userMessageId,
      });
      scheduleResolution = await scheduleCandidateService.extractCandidatesForTurn({
        content: normalizedContent,
        previousUserContent,
      });
      if (scheduleResolution.candidates.length > 0) {
        scheduleCandidates = await scheduleCandidateService.createCandidatesForMessage({
          userId,
          sessionId: sessionDbId,
          sourceMessageId: userMessageId,
          content: scheduleResolution.combinedContent || normalizedContent,
        });
      }
    } catch (error) {
      console.error('[ChatService] Schedule extraction error:', error.message);
    }
  }

  const promptContext = await composePromptContext({
    user,
    userId,
    sessionId: sessionDbId,
    userMessageId,
    userContent: normalizedContent || memoryInput || displayContent,
    currentAttachmentContext,
    hasKnowledgeInput: Boolean(normalizedImportedUrl || normalizedFiles.length > 0 || normalizedAttachments.length > 0),
    disablePersistentMemory,
  });
  const isExplicitScheduleAdd = EXPLICIT_SCHEDULE_REQUEST_PATTERN.test(normalizedContent);
  const wellnessInCurrentMsg = WELLNESS_CONTEXT_PATTERN.test(normalizedContent);
  const wellnessRecoveryPlanAdd = isExplicitScheduleAdd && scheduleCandidates.length === 0
    && (wellnessInCurrentMsg || await hasRecentWellnessContext(sessionDbId, userMessageId));

  promptContext.conversationContext = {
    ...(promptContext.conversationContext || {}),
    scheduleContext: {
      requestedAdd: isExplicitScheduleAdd,
      wellnessRecoveryPlanAdd,
      candidateCount: scheduleCandidates.length,
      hasCandidates: scheduleCandidates.length > 0,
      source: scheduleResolution.source || 'none',
      candidates: scheduleCandidates.map((candidate) => ({
        title: candidate.title,
        dateText: candidate.dateText || '',
        location: candidate.location || '',
      })),
    },
  };

  let reply = '';
  try {
    reply = await ai.getAIReply(
      user,
      analysisContent || displayContent,
      promptContext,
      promptContext.conversationContext
    );
  } catch (error) {
    console.error('[ChatService] AI Service Error:', error.message);
    reply = `I'm here, ${user.name || 'there'}. But I'm having trouble connecting to my cognitive core. What's on your mind?`;
  }

  const [assistantMessageResult] = await db.execute(
    'INSERT INTO chat_messages (session_id, user_id, role, content, voice_id) VALUES (?, ?, ?, ?, ?)',
    [sessionDbId, userId, 'assistant', reply, currentVoiceMode]
  );
  let assistantScheduleCandidates = [];
  let assistantPracticeSuggestions = [];
  try {
    assistantScheduleCandidates = await scheduleCandidateService.createCandidatesFromAssistantReply({
      userId,
      sessionId: sessionDbId,
      sourceMessageId: assistantMessageResult.insertId,
      content: reply,
    });
  } catch (error) {
    console.error('[ChatService] Assistant schedule extraction error:', error.message);
  }
  try {
    assistantPracticeSuggestions = buildPracticeSuggestionsFromAssistantReply({
      content: reply,
      now: new Date(),
    });
  } catch (error) {
    console.error('[ChatService] Assistant practice extraction error:', error.message);
  }
  if (wellnessRecoveryPlanAdd) {
    try {
      // Extract wellness activities from the reply regardless of AI output format.
      // Return as pending (saved:false) so the user sees confirmation cards in chat.
      let extracted = await scheduleCandidateService.extractWellnessPlanFromReply({ content: reply, now: new Date() });

      // Fallback: if the AI reply had no extractable activities (e.g. it just asked a question),
      // scan the last 3 assistant messages in this session and combine them as context.
      if (extracted.length === 0) {
        try {
          const [recentRows] = await db.execute(
            `SELECT content FROM chat_messages
             WHERE session_id = ? AND role = 'assistant' AND id < ?
             ORDER BY id DESC LIMIT 3`,
            [sessionDbId, assistantMessageResult.insertId]
          );
          if (recentRows.length > 0) {
            const combinedContext = [
              ...recentRows.reverse().map((r) => r.content),
              reply,
            ].join('\n\n---\n\n');
            extracted = await scheduleCandidateService.extractWellnessPlanFromReply({ content: combinedContext, now: new Date() });
          }
        } catch (fallbackError) {
          console.error('[ChatService] Wellness fallback extraction error:', fallbackError.message);
        }
      }

      if (extracted.length > 0) {
        const normalizeKey = (s) => String(s || '').replace(/[\s\W]+/g, '-').toLowerCase().slice(0, 24);
        const pending = extracted.map((item, index) => ({
          id: `assistant-wellness:${item.suggestionDate}:${index}:${normalizeKey(item.title)}`,
          rawId: null,
          title: item.title,
          description: item.description,
          recommendedTime: item.recommendedTime,
          actionPrompt: item.actionPrompt,
          status: 'pending',
          completedAt: null,
          saved: false,
          suggestionDate: item.suggestionDate,
        }));
        // Merge with any regex-extracted suggestions; dedupe by title
        const existing = new Set(assistantPracticeSuggestions.map((s) => s.title));
        assistantPracticeSuggestions = [
          ...assistantPracticeSuggestions,
          ...pending.filter((s) => !existing.has(s.title)),
        ];
      }
    } catch (error) {
      console.error('[ChatService] Wellness plan extraction error:', error.message);
    }
  }

  if (assistantPracticeSuggestions.length > 0) {
    try {
      await db.execute(
        `UPDATE chat_messages
         SET practice_suggestions_json = ?
         WHERE id = ? AND user_id = ?`,
        [JSON.stringify(assistantPracticeSuggestions), assistantMessageResult.insertId, userId]
      );
    } catch (error) {
      console.error('[ChatService] Persist assistant practice suggestions error:', error.message);
    }
  }

  if (!disablePersistentMemory) {
    interventionService.captureAssistantInterventions({
      userId,
      sessionId: sessionDbId,
      userMessageId,
      assistantMessageId: assistantMessageResult.insertId,
      userContent: normalizedContent || memoryInput || displayContent,
      assistantContent: reply,
      activeLoops: promptContext?.conversationContext?.activeLoops || [],
    }).catch((error) => {
      console.error('[ChatService] Intervention capture error:', error.message);
    });
  }

  updateDayProfile(userId, textAnalysis).catch((error) => {
    console.error('[ChatService] Day profile error:', error.message);
  });
  db.execute('UPDATE users SET last_active = NOW() WHERE id = ?', [userId]).catch(() => {});
  memory.captureTurn({
    userId,
    sessionId: sessionDbId,
    mode: user.voice_mode || 'classic',
    userMessageId,
    assistantMessageId: assistantMessageResult.insertId,
    userContent: memoryInput || displayContent,
    assistantContent: reply,
    analysis: textAnalysis,
    disablePersistentMemory,
  }).catch((error) => {
    console.error('[ChatService] Memory capture error:', error.message);
  });

  return {
    reply,
    sessionId: resolvedSessionKey,
    voiceId: currentVoiceMode,
    temporaryChat: Boolean(sessionIsTemporary),
    userMessage: {
      id: userMessageId,
      role: 'user',
      content: displayContent,
      voiceId: currentVoiceMode,
      temporaryChat: Boolean(sessionIsTemporary),
      attachments: resolvedAttachments,
      scheduleCandidates,
      ts: new Date().toISOString(),
    },
    assistantMessage: {
      id: assistantMessageResult.insertId,
      role: 'assistant',
      content: reply,
      voiceId: currentVoiceMode,
      temporaryChat: Boolean(sessionIsTemporary),
      scheduleCandidates: assistantScheduleCandidates,
      practiceSuggestions: assistantPracticeSuggestions,
      ts: new Date().toISOString(),
    },
    analysis: {
      emotion: textAnalysis.dominantEmotion,
      stress: textAnalysis.stressEstimate,
      patterns: textAnalysis.cognitivePatterns,
    },
  };
}

async function hasRecentWellnessContext(sessionId, currentMessageId) {
  const [rows] = await db.execute(
    `SELECT content FROM chat_messages
     WHERE session_id = ? AND id < ? AND role = 'user'
     ORDER BY id DESC LIMIT 5`,
    [sessionId, currentMessageId]
  );
  return rows.some((r) => WELLNESS_CONTEXT_PATTERN.test(r.content || ''));
}

async function findPreviousUserMessageContent({ sessionId, currentMessageId }) {
  const [rows] = await db.execute(
    `SELECT content
     FROM chat_messages
     WHERE session_id = ? AND role = 'user' AND id < ?
     ORDER BY id DESC
     LIMIT 1`,
    [sessionId, currentMessageId]
  );
  return typeof rows?.[0]?.content === 'string' ? rows[0].content.trim() : '';
}

function safeParse(val, fallback) {
  if (!val) return fallback;
  if (typeof val !== 'string') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

async function updateDayProfile(userId, analysis) {
  if (!analysis) return;
  const today = new Date().toISOString().split('T')[0];
  const dow = new Date().toLocaleDateString('en', { weekday: 'long' });
  const [rows] = await db.execute('SELECT * FROM day_profiles WHERE user_id = ? AND date = ?', [userId, today]);

  if (rows.length === 0) {
    await db.execute(
      `INSERT INTO day_profiles (user_id, date, day_of_week, chat_stress, chat_peak, chat_emotions, chat_topics, chat_patterns, chat_engagement, chat_count, composite_stress)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        userId,
        today,
        dow,
        analysis.stressEstimate,
        analysis.stressEstimate,
        JSON.stringify([analysis.dominantEmotion]),
        JSON.stringify(analysis.topics || []),
        JSON.stringify(analysis.cognitivePatterns || []),
        analysis.wordCount,
        analysis.stressEstimate,
      ]
    );
    return;
  }

  const dayProfile = rows[0];
  const emotions = safeParse(dayProfile.chat_emotions, []);
  const topics = safeParse(dayProfile.chat_topics, []);
  const patterns = safeParse(dayProfile.chat_patterns, []);
  if (Array.isArray(emotions)) {
    emotions.push(analysis.dominantEmotion);
  }
  const nextTopics = [...new Set([...(Array.isArray(topics) ? topics : []), ...(analysis.topics || [])])];
  const nextPatterns = [...new Set([...(Array.isArray(patterns) ? patterns : []), ...(analysis.cognitivePatterns || [])])];
  const nextCount = (dayProfile.chat_count || 0) + 1;
  const nextStress = ((parseFloat(dayProfile.chat_stress) || 0) * (dayProfile.chat_count || 0) + analysis.stressEstimate) / nextCount;
  const nextPeak = Math.max(parseFloat(dayProfile.chat_peak) || 0, analysis.stressEstimate);

  await db.execute(
    `UPDATE day_profiles SET chat_stress=?, chat_peak=?, chat_emotions=?, chat_topics=?, chat_patterns=?, chat_engagement=?, chat_count=?
     WHERE user_id=? AND date=?`,
    [
      nextStress,
      nextPeak,
      JSON.stringify(emotions),
      JSON.stringify(nextTopics),
      JSON.stringify(nextPatterns),
      (dayProfile.chat_engagement || 0) + analysis.wordCount,
      nextCount,
      userId,
      today,
    ]
  );
}

module.exports = {
  processChatTurn,
};
