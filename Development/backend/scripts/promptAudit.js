#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const db = require('../src/utils/db');
const engine = require('../src/services/behaviorEngine');
const memoryService = require('../src/services/memoryService');
const interventionService = require('../src/services/interventionService');
const { ensureChatSchema } = require('../src/services/chatSchemaService');
const { composePromptContext } = require('../src/services/prompting/composePromptContext');
const { buildSupportGuidance } = require('../src/services/mentalSupportService');
const { buildFinalSystemPrompt } = require('../src/services/ai');

const createdUserIds = [];

async function main() {
  try {
    await ensureSchemas();

    const extractionSuite = await runExtractionSuite();
    const supportSuite = await runSupportSuite();
    const promptSuite = await runPromptSuite();
    const interventionSuite = await runInterventionSuite();

    const report = {
      generatedAt: new Date().toISOString(),
      suites: {
        extraction: extractionSuite,
        support: supportSuite,
        prompt: promptSuite,
        intervention: interventionSuite,
      },
      thresholds: {
        extractionFalsePositiveRateMax: 0.1,
        extractionMissRateMax: 0.15,
        supportMisrouteRateMax: 0.1,
        promptOverlayFailureRateMax: 0.1,
        interventionFalsePositiveRateMax: 0.1,
      },
      overall: summarizeOverall({
        extractionSuite,
        supportSuite,
        promptSuite,
        interventionSuite,
      }),
    };

    console.log(JSON.stringify(report, null, 2));
    if (!report.overall.passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('[Audit] Failed:', error);
    process.exitCode = 1;
  } finally {
    await cleanup();
    await db.end();
  }
}

async function ensureSchemas() {
  await ensureChatSchema();
  await memoryService.ensureMemorySchema();
  await interventionService.ensureInterventionSchema();
}

async function runExtractionSuite() {
  const cases = [
    {
      id: 'clear_difficult_conversation',
      userContent: '我最近一直卡在怎么跟妈妈开口说我想辞职。',
      expectedMemoryTypes: ['relationship', 'goal'],
      expectedLoopTypes: ['difficult_conversation'],
    },
    {
      id: 'clear_goal_process',
      userContent: '我最近在准备产品经理面试，已经开始刷题和改简历。',
      expectedMemoryTypes: ['goal'],
      expectedLoopTypes: ['goal_process'],
    },
    {
      id: 'sleep_recovery',
      userContent: '这阵子一直失眠，最近每晚都睡不好。',
      expectedMemoryTypes: ['emotional_state'],
      expectedLoopTypes: ['sleep_recovery'],
    },
    {
      id: 'upcoming_commitment',
      userContent: '明天要去复诊，我现在有点紧张。',
      expectedMemoryTypes: [],
      expectedLoopTypes: ['upcoming_commitment'],
    },
    {
      id: 'emotional_cycle',
      userContent: '我总是在要汇报前反复想最坏的情况，最近一直很焦虑。',
      expectedMemoryTypes: ['problem_pattern', 'emotional_state'],
      expectedLoopTypes: ['emotional_cycle'],
    },
    {
      id: 'support_preference_direct',
      userContent: '你直接一点，别安慰我，给我结论。',
      expectedMemoryTypes: ['support_style'],
      expectedLoopTypes: [],
    },
    {
      id: 'support_preference_slow',
      userContent: '你可以慢一点，多问我，不要一下子给很多建议。',
      expectedMemoryTypes: ['support_style'],
      expectedLoopTypes: [],
    },
    {
      id: 'trigger_sentence',
      userContent: '每次一想到周会发言我就会心慌。',
      expectedMemoryTypes: ['trigger'],
      expectedLoopTypes: [],
    },
    {
      id: 'action_history',
      userContent: '我试过把任务拆小，也试过早点睡，但后来都没坚持住。',
      expectedMemoryTypes: ['action_history'],
      expectedLoopTypes: [],
    },
    {
      id: 'hypothetical_should_ignore',
      userContent: '如果我明天去跟老板开口会不会很奇怪？',
      expectedMemoryTypes: [],
      expectedLoopTypes: [],
    },
    {
      id: 'question_like_should_ignore',
      userContent: '你还记得我之前是不是提过失眠？',
      expectedMemoryTypes: [],
      expectedLoopTypes: [],
    },
    {
      id: 'reported_speech_should_ignore',
      userContent: '我妈妈说我一直不敢跟老板开口，但那是她的看法。',
      expectedMemoryTypes: [],
      expectedLoopTypes: [],
    },
    {
      id: 'file_followup_should_ignore',
      userContent: '你先看这个文件，等下再说。',
      expectedMemoryTypes: [],
      expectedLoopTypes: [],
    },
    {
      id: 'generic_short_emotion',
      userContent: '今天有点烦。',
      expectedMemoryTypes: [],
      expectedLoopTypes: [],
    },
    {
      id: 'english_sleep_case',
      userContent: 'Lately I keep waking up at 4am and cannot fall back asleep.',
      expectedMemoryTypes: [],
      expectedLoopTypes: [],
    },
    {
      id: 'relationship_without_loop',
      userContent: '我和老板最近关系很紧绷，每次见到他都很压抑。',
      expectedMemoryTypes: ['relationship', 'trigger'],
      expectedLoopTypes: [],
    },
    {
      id: 'goal_and_deadline',
      userContent: '我正在准备转岗，这周要去和主管沟通岗位调整。',
      expectedMemoryTypes: ['goal'],
      expectedLoopTypes: ['goal_process', 'upcoming_commitment'],
    },
    {
      id: 'mixed_negative_quote',
      userContent: '“我总是很糟糕”这句话是我朋友说的，不是我现在的想法。',
      expectedMemoryTypes: [],
      expectedLoopTypes: [],
    },
  ];

  const results = [];
  for (const testCase of cases) {
    const user = await createAuditUser({ emailTag: `extract_${testCase.id}` });
    const session = await createSession(user.id, `extract_${testCase.id}`);
    const analysis = engine.analyzeText(testCase.userContent);
    const turn = await insertChatTurn({
      userId: user.id,
      sessionId: session.id,
      userContent: testCase.userContent,
      assistantContent: '我听到了，我们继续。',
      analysis,
    });

    await memoryService.captureTurn({
      userId: user.id,
      sessionId: session.id,
      mode: 'classic',
      userMessageId: turn.userMessageId,
      assistantMessageId: turn.assistantMessageId,
      userContent: testCase.userContent,
      assistantContent: '我听到了，我们继续。',
      analysis,
      disablePersistentMemory: false,
    });

    const memories = await memoryService.listUserMemories({ userId: user.id, limit: 20 });
    const activeLoops = await memoryService.listUserActiveLoops({ userId: user.id, limit: 20 });
    const actualMemoryTypes = unique(memories.map((item) => item.memoryType));
    const actualLoopTypes = unique(activeLoops.map((item) => item.loopType));
    const missingMemoryTypes = difference(testCase.expectedMemoryTypes, actualMemoryTypes);
    const unexpectedMemoryTypes = difference(actualMemoryTypes, testCase.expectedMemoryTypes);
    const missingLoopTypes = difference(testCase.expectedLoopTypes, actualLoopTypes);
    const unexpectedLoopTypes = difference(actualLoopTypes, testCase.expectedLoopTypes);

    results.push({
      id: testCase.id,
      actualMemoryTypes,
      actualLoopTypes,
      missingMemoryTypes,
      unexpectedMemoryTypes,
      missingLoopTypes,
      unexpectedLoopTypes,
      passed: missingMemoryTypes.length === 0
        && unexpectedMemoryTypes.length === 0
        && missingLoopTypes.length === 0
        && unexpectedLoopTypes.length === 0,
    });
  }

  const expectedSignals = results.reduce((sum, item, index) => (
    sum
    + cases[index].expectedMemoryTypes.length
    + cases[index].expectedLoopTypes.length
  ), 0);
  const missedSignals = results.reduce((sum, item) => (
    sum
    + item.missingMemoryTypes.length
    + item.missingLoopTypes.length
  ), 0);
  const unexpectedSignals = results.reduce((sum, item) => (
    sum
    + item.unexpectedMemoryTypes.length
    + item.unexpectedLoopTypes.length
  ), 0);

  return {
    cases: results,
    metrics: {
      totalCases: results.length,
      passedCases: results.filter((item) => item.passed).length,
      expectedSignals,
      missedSignals,
      unexpectedSignals,
      missRate: ratio(missedSignals, expectedSignals),
      falsePositiveRate: ratio(unexpectedSignals, Math.max(expectedSignals, results.length)),
    },
  };
}

async function runSupportSuite() {
  const cases = [
    { id: 'generic_anxiety', query: '我现在很焦虑，胸口发紧，总觉得要出事。', expectedModuleId: 'anxiety_escalation' },
    { id: 'difficult_conversation', query: '我不知道怎么跟妈妈开口说我想搬出去住。', expectedModuleId: 'difficult_conversation' },
    { id: 'boundary', query: '我总是不好意思拒绝同事，心里越来越委屈。', expectedModuleId: 'boundaries_relationship' },
    { id: 'sleep', query: '这阵子晚上很累，但一躺下脑子就停不下来，睡不着。', expectedModuleId: 'sleep_disruption' },
    { id: 'low_mood', query: '我这几天很低落，提不起劲，什么都不想做。', expectedModuleId: 'low_mood_inertia' },
    { id: 'rumination', query: '我一直在反复想那次汇报，完全停不下来。', expectedModuleId: 'rumination' },
    { id: 'file_followup', query: '你看下我刚发的 PDF 主要讲了什么？', expectedModuleId: null, expectedEmptyContext: true, retrievalIntent: 'file_or_url_followup' },
    { id: 'schedule', query: '帮我看看明天下午 3 点到 5 点有没有空。', expectedModuleId: null, expectedEmptyContext: true, retrievalIntent: 'schedule_logistics' },
    { id: 'neutral_problem_solving', query: '帮我整理一下这个项目方案的优先级。', expectedModuleId: null },
    { id: 'memory_audit', query: '你还记得我之前说过什么吗？', expectedModuleId: null, expectedEmptyContext: true, retrievalIntent: 'memory_audit' },
    { id: 'high_risk', query: '我真的不想活了，今晚就想结束掉。', expectedRiskLevel: 'imminent' },
    { id: 'relationship_vs_boundary', query: '我和伴侣最近沟通很僵，每次说到钱就吵。', expectedModuleId: 'difficult_conversation' },
    { id: 'sleep_with_context_noise', query: '昨晚又很早醒了。', memoryContext: '【共享长期记忆】\n- 用户容易反复想工作评价', expectedModuleId: 'sleep_disruption' },
    { id: 'factual_with_emotion_word', query: '给我一个焦虑研究的论文摘要。', expectedModuleId: null },
  ];

  const results = cases.map((testCase) => {
    const guidance = buildSupportGuidance({
      query: testCase.query,
      memoryContext: testCase.memoryContext || '',
      recentMessages: [],
      retrievalIntent: testCase.retrievalIntent || 'general_support',
    });
    const passed = testCase.expectedRiskLevel
      ? guidance.riskLevel === testCase.expectedRiskLevel
      : guidance.selectedModuleId === testCase.expectedModuleId
        && (testCase.expectedEmptyContext ? guidance.context === '' : true);

    return {
      id: testCase.id,
      selectedModuleId: guidance.selectedModuleId,
      riskLevel: guidance.riskLevel,
      responseMode: guidance.responseMode,
      contextLength: guidance.context.length,
      passed,
    };
  });

  const misroutes = results.filter((item) => !item.passed).length;
  return {
    cases: results,
    metrics: {
      totalCases: results.length,
      passedCases: results.filter((item) => item.passed).length,
      misroutes,
      misrouteRate: ratio(misroutes, results.length),
      averageContextLength: average(results.map((item) => item.contextLength)),
      maxContextLength: Math.max(...results.map((item) => item.contextLength), 0),
    },
  };
}

async function runPromptSuite() {
  const user = await createAuditUser({
    emailTag: 'prompt_primary',
    name: 'Audit Prompt User',
    age: 31,
    bio: '长期在工作与家庭压力之间摇摆，希望被直接但不冷硬地支持。',
    challenges: JSON.stringify(['睡眠波动', '困难对话', '职业转岗']),
    trigs: JSON.stringify(['和妈妈沟通', '周会发言']),
    sleep: 4,
    work: 8,
  });
  await seedDayProfiles(user.id);
  await seedPromptMemories(user.id);
  await seedInterventionPreferences(user.id);

  const cases = [
    {
      id: 'emotional_support_case',
      query: '我这两天压力特别大，感觉快撑不住了。',
      expectedIntent: 'emotional_support',
      expectStateSection: true,
      expectSupportContext: true,
    },
    {
      id: 'problem_solving_case',
      query: '你直接一点，帮我梳理下一步，我要怎么跟老板谈转岗。',
      expectedIntent: 'relationship_conversation',
      expectStateSection: true,
      expectSupportContext: true,
      expectCompactProfile: true,
    },
    {
      id: 'file_followup_case',
      query: '我刚刚那个文件主要讲了什么？',
      hasKnowledgeInput: true,
      currentAttachmentContext: '【当前附件内容】\n- 文档主题：转岗面试准备\n- 关键信息：卡在和老板沟通时间点',
      expectedIntent: 'file_or_url_followup',
      expectStateSection: false,
      expectSupportContext: false,
      expectAttachmentBeforeMemory: true,
    },
    {
      id: 'memory_audit_case',
      query: '你还记得我之前说过哪些事情吗？',
      expectedIntent: 'memory_audit',
      expectStateSection: false,
      expectSupportContext: false,
      expectMemoryRule: true,
    },
    {
      id: 'schedule_case',
      query: '明天下午三点到五点我要去医院复诊，帮我记一下。',
      expectedIntent: 'schedule_logistics',
      expectStateSection: false,
      expectSupportContext: false,
    },
    {
      id: 'sleep_case',
      query: '我最近总是睡不着，凌晨四点醒来后就再也睡不回去。',
      expectedIntent: 'sleep_recovery',
      expectStateSection: true,
      expectSupportContext: true,
    },
    {
      id: 'general_case',
      query: '今天有点烦，但我也说不上来具体是什么。',
      expectedIntent: 'general_support',
      expectStateSection: true,
      expectSupportContext: true,
    },
    {
      id: 'attachment_plus_emotion_case',
      query: '看完这个文件后我更焦虑了，你先告诉我最关键的结论。',
      hasKnowledgeInput: true,
      currentAttachmentContext: '【当前附件内容】\n- 文件是体检报告，建议后续复诊',
      expectedIntent: 'file_or_url_followup',
      expectStateSection: false,
      expectSupportContext: true,
      expectAttachmentBeforeMemory: true,
    },
    {
      id: 'active_problem_solving_case',
      query: '别安慰我，直接说我下一步先做什么。',
      expectedIntent: 'active_problem_solving',
      expectStateSection: true,
      expectSupportContext: true,
      expectCompactProfile: true,
    },
    {
      id: 'relationship_case',
      query: '我每次想和妈妈谈边界就很愧疚，不知道怎么开口。',
      expectedIntent: 'relationship_conversation',
      expectStateSection: true,
      expectSupportContext: true,
    },
    {
      id: 'memory_plus_attachment_case',
      query: '我刚传的简历里，我最近在准备什么？',
      hasKnowledgeInput: true,
      currentAttachmentContext: '【当前附件内容】\n- 最近在准备产品经理转岗；仍卡在和老板开口',
      expectedIntent: 'file_or_url_followup',
      expectStateSection: false,
      expectSupportContext: false,
      expectAttachmentBeforeMemory: true,
    },
    {
      id: 'logistics_with_emotion_case',
      query: '明天要复诊我有点紧张，帮我看看怎么安排。',
      expectedIntent: 'schedule_logistics',
      expectStateSection: false,
      expectSupportContext: true,
    },
    {
      id: 'direct_mode_case',
      query: '给我一个很直接的执行方案。',
      userVoiceMode: 'direct',
      expectedIntent: 'active_problem_solving',
      expectStateSection: true,
      expectSupportContext: true,
      expectCompactProfile: true,
    },
    {
      id: 'new_attachment_case',
      query: '这个链接里最关键的信息是什么？',
      hasKnowledgeInput: true,
      currentAttachmentContext: '【当前附件内容】\n- 一篇关于失眠恢复的公开文章',
      expectedIntent: 'file_or_url_followup',
      expectStateSection: false,
      expectSupportContext: false,
      expectAttachmentBeforeMemory: true,
    },
    {
      id: 'memory_with_distress_case',
      query: '你还记得我之前说过什么吗，我现在有点崩。',
      expectedIntent: 'memory_audit',
      expectStateSection: false,
      expectSupportContext: false,
      expectMemoryRule: true,
    },
    {
      id: 'sleep_attachment_case',
      query: '我传了睡眠记录，你帮我看看重点，再告诉我今晚先做什么。',
      hasKnowledgeInput: true,
      currentAttachmentContext: '【当前附件内容】\n- 最近 7 天平均入睡时间 2:10，4 天凌晨醒来',
      expectedIntent: 'file_or_url_followup',
      expectStateSection: false,
      expectSupportContext: false,
      expectAttachmentBeforeMemory: true,
    },
  ];

  const session = await createSession(user.id, 'prompt_suite_session');
  await seedPromptMessages(user.id, session.id);
  const promptUser = await fetchUser(user.id);
  const results = [];

  for (const testCase of cases) {
    const [messageResult] = await db.execute(
      'INSERT INTO chat_messages (session_id, user_id, role, content, attachments, analysis, voice_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        session.id,
        user.id,
        'user',
        testCase.query,
        JSON.stringify([]),
        JSON.stringify(engine.analyzeText(testCase.query)),
        testCase.userVoiceMode || promptUser.voice_mode || 'classic',
      ]
    );

    const promptContext = await composePromptContext({
      user: {
        ...promptUser,
        voice_mode: testCase.userVoiceMode || promptUser.voice_mode,
      },
      userId: user.id,
      sessionId: session.id,
      userMessageId: messageResult.insertId,
      userContent: testCase.query,
      currentAttachmentContext: testCase.currentAttachmentContext || '',
      hasKnowledgeInput: Boolean(testCase.hasKnowledgeInput),
      disablePersistentMemory: false,
    });
    const supportGuidance = buildSupportGuidance({
      query: testCase.query,
      memoryContext: [promptContext.conversationContext.memoryContext, promptContext.conversationContext.attachmentContext].filter(Boolean).join('\n\n'),
      recentMessages: promptContext.conversationContext.recentMessages || [],
      retrievalIntent: promptContext.conversationContext.retrievalIntent,
    });
    const finalPrompt = buildFinalSystemPrompt(promptContext, {
      ...promptContext.conversationContext,
      supportContext: supportGuidance.context,
    }, testCase.query);
    const systemPrompt = promptContext.systemPrompt || promptContext.systemPromptSections.join('\n\n');

    const stateIncluded = systemPrompt.includes('【最近状态画像】');
    const profileCompact = !systemPrompt.includes('- 自我描述：') && !systemPrompt.includes('- 主动填写的触发项：');
    const supportIncluded = supportGuidance.context.length > 0;
    const attachmentBeforeMemory = !testCase.expectAttachmentBeforeMemory
      || finalPrompt.indexOf('【当前附件内容】') >= 0 && (
        finalPrompt.indexOf('【共享长期记忆】') === -1
          || finalPrompt.indexOf('【当前附件内容】') < finalPrompt.indexOf('【共享长期记忆】')
      );
    const passed = promptContext.conversationContext.retrievalIntent === testCase.expectedIntent
      && stateIncluded === testCase.expectStateSection
      && supportIncluded === testCase.expectSupportContext
      && (testCase.expectCompactProfile ? profileCompact : true)
      && (testCase.expectMemoryRule ? finalPrompt.includes('【记忆使用规则】') : true)
      && attachmentBeforeMemory;

    results.push({
      id: testCase.id,
      retrievalIntent: promptContext.conversationContext.retrievalIntent,
      systemPromptLength: systemPrompt.length,
      finalPromptLength: finalPrompt.length,
      memoryContextLength: promptContext.conversationContext.memoryContext.length,
      attachmentContextLength: promptContext.conversationContext.attachmentContext.length,
      supportContextLength: supportGuidance.context.length,
      stateIncluded,
      supportIncluded,
      profileCompact,
      attachmentBeforeMemory,
      passed,
    });
  }

  const failures = results.filter((item) => !item.passed).length;
  return {
    cases: results,
    metrics: {
      totalCases: results.length,
      passedCases: results.filter((item) => item.passed).length,
      overlayFailureRate: ratio(failures, results.length),
      averageSystemPromptLength: average(results.map((item) => item.systemPromptLength)),
      averageFinalPromptLength: average(results.map((item) => item.finalPromptLength)),
      averageSupportContextLength: average(results.map((item) => item.supportContextLength)),
      averageMemoryContextLength: average(results.map((item) => item.memoryContextLength)),
    },
  };
}

async function runInterventionSuite() {
  const detectionUser = await createAuditUser({ emailTag: 'intervention_detection' });
  const behaviorUser = await createAuditUser({ emailTag: 'intervention_behavior' });
  const detectionCases = [
    { id: 'direct_script', reply: '你可以这样说：妈妈，我想先自己住一段时间。', userContent: '我不知道怎么跟妈妈开口', expectedTypes: ['difficult_conversation_script'] },
    { id: 'task_breakdown', reply: '第一步先把要说的三点写下来，第二步只发预约时间。', userContent: '我现在很乱', expectedTypes: ['task_breakdown'] },
    { id: 'grounding', reply: '先把脚踩地，看看周围五样东西，让身体落地。', userContent: '我快慌了', expectedTypes: ['grounding'] },
    { id: 'breathing', reply: '先慢慢吸气四拍，再吐气六拍，做三轮。', userContent: '我很紧张', expectedTypes: ['breathing'] },
    { id: 'journaling', reply: '先把现在最乱的三句话写下来，不用整理成完整日记。', userContent: '我脑子很乱', expectedTypes: ['journaling'] },
    { id: 'boundary', reply: '你不需要现在答应，可以先回到自己的节奏。', userContent: '我总是不好意思拒绝', expectedTypes: ['boundary_prompt'] },
    { id: 'reflection', reply: '你可以先问自己，如果只挑一个最想解决的问题，会是什么？', userContent: '我不知道先做什么', expectedTypes: ['reflection_question'] },
    { id: 'warm_support_only', reply: '我在这，你不用急，我们一点点来。', userContent: '我很难受', expectedTypes: [] },
    { id: 'mixed_script_and_steps', reply: '你可以先发这句给老板。第一步只约 15 分钟沟通时间。', userContent: '我不知道怎么跟老板说', expectedTypes: ['difficult_conversation_script', 'task_breakdown'] },
    { id: 'false_positive_check', reply: '我听到了，你已经很不容易。', userContent: '我想休息一下', expectedTypes: [] },
  ];

  const detectionResults = [];
  for (const testCase of detectionCases) {
    const session = await createSession(detectionUser.id, `intervention_${testCase.id}`);
    const turn = await insertChatTurn({
      userId: detectionUser.id,
      sessionId: session.id,
      userContent: testCase.userContent,
      assistantContent: testCase.reply,
      analysis: engine.analyzeText(testCase.userContent),
    });

    const created = await interventionService.captureAssistantInterventions({
      userId: detectionUser.id,
      sessionId: session.id,
      userMessageId: turn.userMessageId,
      assistantMessageId: turn.assistantMessageId,
      userContent: testCase.userContent,
      assistantContent: testCase.reply,
      activeLoops: [],
    });

    const actualTypes = unique(created.map((item) => item.interventionType));
    detectionResults.push({
      id: testCase.id,
      actualTypes,
      expectedTypes: testCase.expectedTypes,
      passed: sameMembers(actualTypes, testCase.expectedTypes),
    });
  }

  const followupSession = await createSession(behaviorUser.id, 'intervention_followup');
  const followupTurn = await insertChatTurn({
    userId: behaviorUser.id,
    sessionId: followupSession.id,
    userContent: '我不知道怎么跟妈妈开口。',
    assistantContent: '你可以这样说：妈妈，我想先自己住一段时间。',
    analysis: engine.analyzeText('我不知道怎么跟妈妈开口。'),
  });
  const createdFollowup = await interventionService.captureAssistantInterventions({
    userId: behaviorUser.id,
    sessionId: followupSession.id,
    userMessageId: followupTurn.userMessageId,
    assistantMessageId: followupTurn.assistantMessageId,
    userContent: '我不知道怎么跟妈妈开口。',
    assistantContent: '你可以这样说：妈妈，我想先自己住一段时间。',
    activeLoops: [],
  });
  await interventionService.captureChatFollowupSignals({
    userId: behaviorUser.id,
    sessionId: followupSession.id,
    userContent: '好，我试试看，等会我就发。',
  });

  const followthroughSession = await createSession(behaviorUser.id, 'intervention_followthrough');
  const followthroughTurn = await insertChatTurn({
    userId: behaviorUser.id,
    sessionId: followthroughSession.id,
    userContent: '我还是不知道怎么跟妈妈开口。',
    assistantContent: '你可以这样说：妈妈，我想先自己住一段时间。',
    analysis: engine.analyzeText('我还是不知道怎么跟妈妈开口。'),
  });
  await interventionService.captureAssistantInterventions({
    userId: behaviorUser.id,
    sessionId: followthroughSession.id,
    userMessageId: followthroughTurn.userMessageId,
    assistantMessageId: followthroughTurn.assistantMessageId,
    userContent: '我还是不知道怎么跟妈妈开口。',
    assistantContent: '你可以这样说：妈妈，我想先自己住一段时间。',
    activeLoops: [],
  });
  await interventionService.captureChatFollowupSignals({
    userId: behaviorUser.id,
    sessionId: followthroughSession.id,
    userContent: '我刚刚发了。',
  });

  const rejectSession = await createSession(behaviorUser.id, 'intervention_reject');
  const rejectTurn = await insertChatTurn({
    userId: behaviorUser.id,
    sessionId: rejectSession.id,
    userContent: '我现在很乱。',
    assistantContent: '先慢慢吸气四拍，再吐气六拍，做三轮。',
    analysis: engine.analyzeText('我现在很乱。'),
  });
  await interventionService.captureAssistantInterventions({
    userId: behaviorUser.id,
    sessionId: rejectSession.id,
    userMessageId: rejectTurn.userMessageId,
    assistantMessageId: rejectTurn.assistantMessageId,
    userContent: '我现在很乱。',
    assistantContent: '先慢慢吸气四拍，再吐气六拍，做三轮。',
    activeLoops: [],
  });
  await interventionService.captureChatFollowupSignals({
    userId: behaviorUser.id,
    sessionId: rejectSession.id,
    userContent: '没用，我不想做这个。',
  });

  const rejectSession2 = await createSession(behaviorUser.id, 'intervention_reject_2');
  const rejectTurn2 = await insertChatTurn({
    userId: behaviorUser.id,
    sessionId: rejectSession2.id,
    userContent: '我还是很乱。',
    assistantContent: '先慢慢吸气四拍，再吐气六拍，做三轮。',
    analysis: engine.analyzeText('我还是很乱。'),
  });
  await interventionService.captureAssistantInterventions({
    userId: behaviorUser.id,
    sessionId: rejectSession2.id,
    userMessageId: rejectTurn2.userMessageId,
    assistantMessageId: rejectTurn2.assistantMessageId,
    userContent: '我还是很乱。',
    assistantContent: '先慢慢吸气四拍，再吐气六拍，做三轮。',
    activeLoops: [],
  });
  await interventionService.captureChatFollowupSignals({
    userId: behaviorUser.id,
    sessionId: rejectSession2.id,
    userContent: '还是没用，我不想做呼吸。',
  });

  const taskSession = await createSession(behaviorUser.id, 'intervention_task_behavior');
  const taskTurn = await insertChatTurn({
    userId: behaviorUser.id,
    sessionId: taskSession.id,
    userContent: '我不知道先做哪一步。',
    assistantContent: '第一步先列出三个最小动作，第二步只做第一件。',
    analysis: engine.analyzeText('我不知道先做哪一步。'),
  });
  const taskCreated = await interventionService.captureAssistantInterventions({
    userId: behaviorUser.id,
    sessionId: taskSession.id,
    userMessageId: taskTurn.userMessageId,
    assistantMessageId: taskTurn.assistantMessageId,
    userContent: '我不知道先做哪一步。',
    assistantContent: '第一步先列出三个最小动作，第二步只做第一件。',
    activeLoops: [],
  });

  const sleepSession = await createSession(behaviorUser.id, 'intervention_sleep_behavior');
  const sleepTurn = await insertChatTurn({
    userId: behaviorUser.id,
    sessionId: sleepSession.id,
    userContent: '我最近总是睡不好。',
    assistantContent: '今晚先别继续刷，先去躺下，把灯光调暗。',
    analysis: engine.analyzeText('我最近总是睡不好。'),
  });
  const sleepCreated = await interventionService.captureAssistantInterventions({
    userId: behaviorUser.id,
    sessionId: sleepSession.id,
    userMessageId: sleepTurn.userMessageId,
    assistantMessageId: sleepTurn.assistantMessageId,
    userContent: '我最近总是睡不好。',
    assistantContent: '今晚先别继续刷，先去躺下，把灯光调暗。',
    activeLoops: [],
  });

  await interventionService.recordBehaviorEvent({
    userId: behaviorUser.id,
    eventType: 'mood_logged',
    eventPayload: {
      stressDelta: -2,
      intentHint: 'sleep_recovery',
    },
  });

  const [taskOutcomeRows] = await db.execute(
    'SELECT outcome_score FROM intervention_outcomes WHERE id = ? LIMIT 1',
    [taskCreated[0]?.id || 0]
  );
  const [sleepOutcomeRows] = await db.execute(
    'SELECT outcome_score FROM intervention_outcomes WHERE id = ? LIMIT 1',
    [sleepCreated[0]?.id || 0]
  );
  const overview = await interventionService.getUserInterventionOverview({ userId: behaviorUser.id, limit: 12 });
  const helpfulTypes = overview.topHelpful.map((item) => item.interventionType);
  const avoidTypes = overview.avoid.map((item) => item.interventionType);
  const taskOutcomeScore = Number(taskOutcomeRows[0]?.outcome_score || 0);
  const sleepOutcomeScore = Number(sleepOutcomeRows[0]?.outcome_score || 0);
  const behaviorPass = helpfulTypes.includes('difficult_conversation_script')
    && avoidTypes.includes('breathing')
    && taskOutcomeScore === 0
    && sleepOutcomeScore > 0;

  const detectionFalsePositives = detectionResults.reduce((sum, item) => sum + difference(item.actualTypes, item.expectedTypes).length, 0);

  return {
    cases: detectionResults,
    metrics: {
      totalCases: detectionResults.length,
      passedCases: detectionResults.filter((item) => item.passed).length,
      falsePositiveRate: ratio(detectionFalsePositives, detectionResults.length),
      helpfulTypes,
      avoidTypes,
      behaviorPass,
      recentOutcomes: overview.recentOutcomes.slice(0, 5),
    },
  };
}

function summarizeOverall({ extractionSuite, supportSuite, promptSuite, interventionSuite }) {
  const passed = extractionSuite.metrics.falsePositiveRate <= 0.1
    && extractionSuite.metrics.missRate <= 0.15
    && supportSuite.metrics.misrouteRate <= 0.1
    && promptSuite.metrics.overlayFailureRate <= 0.1
    && interventionSuite.metrics.falsePositiveRate <= 0.1
    && interventionSuite.metrics.behaviorPass === true;

  return {
    passed,
    extractionMissRate: extractionSuite.metrics.missRate,
    extractionFalsePositiveRate: extractionSuite.metrics.falsePositiveRate,
    supportMisrouteRate: supportSuite.metrics.misrouteRate,
    promptOverlayFailureRate: promptSuite.metrics.overlayFailureRate,
    interventionFalsePositiveRate: interventionSuite.metrics.falsePositiveRate,
  };
}

async function seedDayProfiles(userId) {
  const baseDate = new Date('2026-03-25T00:00:00Z');
  const rows = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(baseDate);
    date.setUTCDate(baseDate.getUTCDate() - index);
    return {
      date: date.toISOString().slice(0, 10),
      stress: 6.2 + (index % 3) * 0.4,
      topics: index % 2 === 0 ? ['工作', '家庭'] : ['睡眠', '边界'],
      patterns: index % 2 === 0 ? ['反复预演'] : ['拖延'],
    };
  });

  for (const row of rows) {
    await db.execute(
      `INSERT INTO day_profiles (
         user_id, date, day_of_week, composite_stress, composite_mood, chat_stress, chat_peak,
         ambient_stress_avg, ambient_stress_peak, ambient_listening_count, ambient_transcript_tokens,
         chat_emotions, chat_topics, chat_patterns, chat_engagement, chat_count,
         mood_avg, stress_avg, stress_peak, journal_topics, journal_patterns, practice_count, practices_done
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         composite_stress = VALUES(composite_stress),
         composite_mood = VALUES(composite_mood),
         chat_topics = VALUES(chat_topics),
         chat_patterns = VALUES(chat_patterns),
         journal_topics = VALUES(journal_topics),
         journal_patterns = VALUES(journal_patterns),
         stress_avg = VALUES(stress_avg),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        row.date,
        weekdayName(row.date),
        row.stress,
        4.8,
        row.stress,
        row.stress + 0.8,
        row.stress - 0.5,
        row.stress,
        1,
        120,
        JSON.stringify(['anxious']),
        JSON.stringify(row.topics),
        JSON.stringify(row.patterns),
        2,
        2,
        4.5,
        row.stress,
        row.stress + 0.7,
        JSON.stringify(['睡眠', '工作']),
        JSON.stringify(['反复预演']),
        1,
        JSON.stringify(['breathing_reset'])
      ]
    );
  }
}

async function seedPromptMemories(userId) {
  const session = await createSession(userId, 'prompt_seed_memories');
  const seededTurns = [
    '我最近在准备产品经理转岗，还卡在怎么跟老板开口。',
    '每次想到和妈妈谈边界我都会先愧疚，再拖着不说。',
    '这阵子一直失眠，凌晨四点常常醒。',
    '你直接一点，别绕，告诉我下一步先做什么。',
  ];

  for (const content of seededTurns) {
    const analysis = engine.analyzeText(content);
    const turn = await insertChatTurn({
      userId,
      sessionId: session.id,
      userContent: content,
      assistantContent: '收到，我们继续。',
      analysis,
    });

    await memoryService.captureTurn({
      userId,
      sessionId: session.id,
      mode: 'classic',
      userMessageId: turn.userMessageId,
      assistantMessageId: turn.assistantMessageId,
      userContent: content,
      assistantContent: '收到，我们继续。',
      analysis,
      disablePersistentMemory: false,
    });
  }
}

async function seedInterventionPreferences(userId) {
  const rows = [
    ['difficult_conversation_script', 4, 3, 0, 4, 3, 0.64, 'helpful', '困难对话时，可直接发送的话术更容易被采纳并执行'],
    ['task_breakdown', 3, 2, 0, 2, 2, 0.52, 'helpful', '任务拆解更容易让用户开始行动'],
    ['breathing', 3, 0, 2, 1, 0, -0.31, 'avoid', '单纯呼吸练习近期更容易被跳过'],
  ];

  for (const row of rows) {
    await db.execute(
      `INSERT INTO user_intervention_preferences (
         user_id, intervention_type, evidence_count, positive_count, negative_count,
         acceptance_count, followthrough_count, avg_outcome_score, effectiveness_label, summary
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
      [userId, ...row]
    );
  }
}

async function seedPromptMessages(userId, sessionId) {
  const messages = [
    { role: 'user', content: '我最近总在想转岗的事。' },
    { role: 'assistant', content: '听起来你已经想了很久。' },
    { role: 'user', content: '对，而且我还没和老板开口。' },
    { role: 'assistant', content: '这件事确实卡住你了。' },
  ];

  for (const message of messages) {
    await db.execute(
      'INSERT INTO chat_messages (session_id, user_id, role, content, attachments, analysis, voice_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        sessionId,
        userId,
        message.role,
        message.content,
        JSON.stringify([]),
        message.role === 'user' ? JSON.stringify(engine.analyzeText(message.content)) : null,
        'classic',
      ]
    );
  }

  await memoryService.rebuildSessionMemories({
    userId,
    sessionId,
    mode: 'classic',
  });
}

async function createAuditUser(overrides = {}) {
  const emailTag = overrides.emailTag || `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const [result] = await db.execute(
    `INSERT INTO users (
       email, password, name, age, bio, challenges, trigs, sleep, work,
       voice_mode, language, memory_enabled, onboarded
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [
      `${emailTag}@audit.local`,
      'audit',
      overrides.name || 'Audit User',
      overrides.age || 29,
      overrides.bio || '',
      overrides.challenges || JSON.stringify([]),
      overrides.trigs || JSON.stringify([]),
      overrides.sleep ?? 5,
      overrides.work ?? 5,
      overrides.voice_mode || 'classic',
      overrides.language || 'zh-CN',
    ]
  );

  createdUserIds.push(result.insertId);
  return fetchUser(result.insertId);
}

async function fetchUser(userId) {
  const [rows] = await db.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows[0];
}

async function createSession(userId, sessionKey) {
  const [result] = await db.execute(
    'INSERT INTO chat_sessions (user_id, session_key, is_temporary) VALUES (?, ?, 0)',
    [userId, `${sessionKey}_${Math.random().toString(36).slice(2, 7)}`]
  );

  return { id: result.insertId };
}

async function insertChatTurn({ userId, sessionId, userContent, assistantContent, analysis }) {
  const [userResult] = await db.execute(
    'INSERT INTO chat_messages (session_id, user_id, role, content, attachments, analysis, voice_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [sessionId, userId, 'user', userContent, JSON.stringify([]), JSON.stringify(analysis || engine.analyzeText(userContent)), 'classic']
  );
  const [assistantResult] = await db.execute(
    'INSERT INTO chat_messages (session_id, user_id, role, content, attachments, analysis, voice_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [sessionId, userId, 'assistant', assistantContent, JSON.stringify([]), null, 'classic']
  );

  return {
    userMessageId: userResult.insertId,
    assistantMessageId: assistantResult.insertId,
  };
}

async function cleanup() {
  if (createdUserIds.length === 0) return;
  await db.execute(
    `DELETE FROM users WHERE id IN (${createdUserIds.map(() => '?').join(', ')})`,
    createdUserIds
  );
}

function weekdayName(dateString) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${dateString}T00:00:00Z`).getUTCDay()];
}

function average(values = []) {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length).toFixed(2));
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function difference(source = [], target = []) {
  const targetSet = new Set(target);
  return source.filter((item) => !targetSet.has(item));
}

function sameMembers(a = [], b = []) {
  return difference(a, b).length === 0 && difference(b, a).length === 0;
}

main();
