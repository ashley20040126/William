const axios = require('axios');
const { getProxyForUrl } = require('proxy-from-env');
const { queryDigitalExpert } = require('./ragService');
const { buildSupportGuidance } = require('./mentalSupportService');

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_TIMEOUT_MS = parseInt(process.env.OPENAI_TIMEOUT_MS || '30000', 10);
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const CLASSIC_FALLBACK_TO_RAG_ON_OPENAI_ERROR = parseBool(
  process.env.CLASSIC_FALLBACK_TO_RAG_ON_OPENAI_ERROR,
  true
);

function parseBool(value, defaultValue) {
  if (value == null || value === '') return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function buildProxyConfig(targetUrl) {
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

async function getAIReply(user, content, systemPrompt, conversationContext = {}) {
  const mode = user.voice_mode || 'classic';
  const promptContext = normalizePromptContext(systemPrompt);
  const { memoryContext = '', recentMessages = [], attachmentContext = '', retrievalPlan = null, retrievalIntent = 'general_support' } = conversationContext;
  const mergedContext = [memoryContext, attachmentContext].filter(Boolean).join('\n\n');

  if (mode === 'direct') {
    const expert = process.env.RAG_SERVICE_EXPERT || 'li_songwei';
    return queryDigitalExpert(content, expert, { memoryContext: mergedContext, recentMessages });
  }

  let supportContext = '';
  try {
    const supportGuidance = await buildSupportGuidance({
      query: content,
      memoryContext: mergedContext,
      recentMessages,
      retrievalIntent: retrievalPlan?.intent || retrievalIntent,
      userStance: retrievalPlan?.userStance || 'neutral',
    });
    supportContext = supportGuidance.context || '';
  } catch (error) {
    console.warn(`[AI] Support guidance unavailable, continuing without it: ${error.message}`);
  }

  try {
    return await getGPT4oMiniReply(content, promptContext, {
      memoryContext,
      recentMessages,
      attachmentContext,
      supportContext,
      retrievalPlan,
      retrievalIntent: retrievalPlan?.intent || retrievalIntent,
    });
  } catch (error) {
    if (!shouldFallbackClassicReplyToRag(error)) {
      throw error;
    }

    const expert = process.env.RAG_SERVICE_EXPERT || 'li_songwei';
    console.warn(`[AI] OpenAI classic reply failed (${error.message}), falling back to RAG expert=${expert}`);
    return queryDigitalExpert(content, expert, {
      memoryContext: mergedContext,
      recentMessages,
    });
  }
}

function normalizePromptContext(systemPrompt) {
  if (typeof systemPrompt === 'string') {
    return {
      systemPrompt,
      sections: [systemPrompt],
      workspaceId: 'william_chat',
    };
  }

  return {
    systemPrompt: systemPrompt?.systemPrompt || '',
    sections: Array.isArray(systemPrompt?.systemPromptSections)
      ? systemPrompt.systemPromptSections.filter(Boolean)
      : (systemPrompt?.systemPrompt ? [systemPrompt.systemPrompt] : []),
    workspaceId: systemPrompt?.workspace?.id || 'william_chat',
  };
}

function buildFinalSystemPrompt(promptContext, conversationContext = {}, userContent = '') {
  const {
    memoryContext = '',
    attachmentContext = '',
    supportContext = '',
    retrievalPlan = null,
    retrievalIntent = 'general_support',
    scheduleContext = null,
  } = conversationContext;
  const resolvedIntent = retrievalPlan?.intent || retrievalIntent;
  const userStance = retrievalPlan?.userStance || 'neutral';
  const secondaryIntent = retrievalPlan?.secondaryIntent || null;
  const baseSections = Array.isArray(promptContext.sections) ? promptContext.sections : [promptContext.systemPrompt].filter(Boolean);
  const orderedContextSections = buildOrderedContextSections({
    retrievalIntent: resolvedIntent,
    memoryContext,
    attachmentContext,
    supportContext,
  });
  const behaviorOverrides = buildBehaviorOverrides({ resolvedIntent, secondaryIntent, userStance, userContent, memoryContext, supportContext, scheduleContext });
  const attachmentRule = attachmentContext
    ? '【知识使用规则】如果用户提到照片、截图、PDF、文件、链接或”这个附件”，优先依据知识上下文回答；看不出来的部分明确说明，不要编造。'
    : '';
  const supportRule = supportContext
    ? '【心理支持规则】如果命中心理支持模块或风险规则，优先遵守这些规则，但把它们当成方向和边界，不要机械照抄成固定模板、固定问句或培训手册。若规则里有”输出要求”，最终回复必须明显体现至少一个锚点，不能只给泛安慰或泛追问。'
    : '';
  const scheduleRule = buildScheduleCapabilityRule(scheduleContext);
  return [
    ...baseSections,
    ...orderedContextSections,
    supportRule,
    attachmentRule,
    scheduleRule,
    ...behaviorOverrides,
  ].filter(Boolean).join('\n\n');
}

function buildScheduleCapabilityRule(scheduleContext = null) {
  if (!scheduleContext) return '';

  if (scheduleContext.hasCandidates) {
    return '【日程能力规则】系统已经根据这条用户消息识别出了可展示的日程候选。不要说”我不能直接加入日程”或”只能帮你记下来”。如果用户明显是在要求加入日程，直接告诉他你已经整理成可确认的计划候选，可以确认或编辑；回复重点放在这条计划本身，不要转成闲聊。';
  }

  if (scheduleContext.wellnessRecoveryPlanAdd) {
    return '【日程能力规则 · 健康恢复计划】用户要求把健康/康复活动加入日程。请直接输出结构化计划，每条一行，格式严格为”[日期][时间段][具体时间]：[活动名称]”，必须包含具体小时，例如”今天晚上7点：散步15分钟””明天早上8点：深呼吸5分钟””明天晚上9点：冥想10分钟”。时间段用”早上””下午””晚上”，具体时间用”X点”。输出3至5条后，告诉用户已加入日程，不要追问。';
  }

  if (scheduleContext.requestedAdd) {
    return '【日程能力规则】用户正在明确要求加入日程，但系统这轮还没有形成候选。不要否认你有这个能力。直接指出还缺什么关键信息（通常是日期或更明确的时间），并请用户补一句。';
  }

  return '';
}

function buildBehaviorOverrides({ resolvedIntent, secondaryIntent = null, userStance = 'neutral', userContent = '', memoryContext = '', supportContext = '', scheduleContext = null }) {
  const overrides = [];

  if (scheduleContext?.hasCandidates) {
    overrides.push(
      '【本轮行为覆盖 · 日程候选已就绪】系统已经为这条消息生成了可确认的日程候选。这一轮不要说”我不能直接加入日程”或”只能帮你记下来”。如果用户是在要求加入日程，就直接说明你已经帮他整理成计划候选，可以确认或编辑。'
    );
  } else if (scheduleContext?.wellnessRecoveryPlanAdd) {
    overrides.push(
      '【本轮行为覆盖 · 健康计划加入日程 · 禁止追问】' +
      '用户已经明确要加入日程，系统会自动处理时间安排，你不需要追问时间偏好。' +
      '这一轮回复必须包含至少3条结构化活动，每条单独一行，格式：今天晚上7点：散步15分钟 / 明天早上8点：深呼吸5分钟 / 明天晚上9点：冥想10分钟。' +
      '输出完活动列表后，用一句话确认”已帮你加入日程”，然后停止。' +
      '严禁以任何形式追问时间偏好，严禁说”你觉得哪个时间段”或”你来选择时间”之类的话。'
    );
  } else if (scheduleContext?.requestedAdd) {
    overrides.push(
      '【本轮行为覆盖 · 日程信息待补】用户正在要求加入日程，但这轮还缺关键时间信息。不要否认自己有日程能力。直接指出缺的是哪一项，并请用户补充一句更明确的日期或时间。'
    );
  }

  // 1. memory_audit：答完就停，不主动追问
  if (resolvedIntent === 'memory_audit' && memoryContext) {
    overrides.push(
      '【本轮行为覆盖 · 记忆确认】如果用户是在确认你是否记得，直接回答你记住的事实，然后停下。除非用户明确要求，否则不要主动追问、分析或延展。'
    );
  }

  // 2. seeking_action stance → 直接给行动，跳过共情铺垫（仅主意图）
  if (userStance === 'seeking_action'
    && (resolvedIntent === 'active_problem_solving' || resolvedIntent === 'relationship_conversation')) {
    overrides.push(
      '【本轮行为覆盖 · 直接行动】用户明确要求直接给行动建议。这一轮跳过共情铺垫，直接给出具体可执行的下一步。如果有多步，先说最重要的第一步。最多附带一个确认性问题，不要连续追问。'
    );
  }

  // 3. relationship_conversation (主意图) + seeking_action + 用户明确在问"怎么开口" → 给可用话术
  const looksLikeScriptRequest = /(怎么开口|怎么说|怎么谈|不知道怎么.{0,6}(谈|说|讲|开口)|说不出口|开不了口|how to bring it up|how do i say)/.test(userContent);
  if (resolvedIntent === 'relationship_conversation' && userStance === 'seeking_action' && looksLikeScriptRequest) {
    overrides.push(
      '【本轮行为覆盖 · 困难对话话术 · 最高优先级】用户已经明确在问怎么开口。这一轮的核心输出必须是一段话术草稿——用户可以直接复制或稍作修改发给对方的 2 到 4 句话，有情境感，不要教科书口吻。可以在话术之后附一句简短说明，但不能用追问代替话术。如果本条规则与其他支持模块规则冲突，以本条为准。'
    );
  }

  // 4. sleep_recovery (仅主意图) → 给即时小动作
  if (resolvedIntent === 'sleep_recovery') {
    overrides.push(
      '【本轮行为覆盖 · 睡眠即时动作】不要先探索原因或追问细节。先给一个用户现在或今晚就能做的具体小动作（比如一个呼吸节奏、一个身体放松动作、一个环境调整），不要变成睡眠卫生讲座。最多一个追问，且只在必要时才问。'
    );
  }

  // 5. venting stance → 别主动推方案，先陪
  if (userStance === 'venting' && resolvedIntent !== 'memory_audit') {
    overrides.push(
      '【本轮行为覆盖 · 陪伴优先】用户在倾诉，不是在求解。这一轮先接住情绪，不要急着分析原因或推方案。除非用户追问，否则不主动给建议。'
    );
  }

  // 6. asking_fact stance → 答事实，不进支持模式
  if (userStance === 'asking_fact') {
    overrides.push(
      '【本轮行为覆盖 · 知识回答】用户在请求事实或知识，不是在求情绪支持。直接回答问题本身，不要主动切入安慰或情绪探索。'
    );
  }

  return overrides;
}

function buildOrderedContextSections({ retrievalIntent = 'general_support', memoryContext = '', attachmentContext = '', supportContext = '' }) {
  if (retrievalIntent === 'file_or_url_followup') {
    return [attachmentContext, memoryContext, supportContext].filter(Boolean);
  }

  if (retrievalIntent === 'memory_audit') {
    return [memoryContext, attachmentContext, supportContext].filter(Boolean);
  }

  return [supportContext, memoryContext, attachmentContext].filter(Boolean);
}

async function getGPT4oMiniReply(content, promptContext, conversationContext = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY in .env file');
  }

  const { recentMessages = [] } = conversationContext;
  const endpoint = `${OPENAI_BASE_URL}/chat/completions`;
  const finalSystemPrompt = buildFinalSystemPrompt(promptContext, conversationContext, content);
  const response = await axios.post(
    endpoint,
    {
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: finalSystemPrompt },
        ...recentMessages,
        { role: 'user', content },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    },
    {
      timeout: OPENAI_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      ...buildProxyConfig(endpoint),
    }
  );

  return response.data?.choices?.[0]?.message?.content || '';
}

function shouldFallbackClassicReplyToRag(error) {
  if (!CLASSIC_FALLBACK_TO_RAG_ON_OPENAI_ERROR) return false;

  const status = Number(error?.response?.status || error?.statusCode || 0);
  const message = String(
    error?.response?.data?.error?.message
    || error?.response?.data?.message
    || error?.message
    || ''
  ).toLowerCase();

  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  return /timeout|rate limit|quota|insufficient_quota|temporar|overloaded|capacity/.test(message);
}

module.exports = {
  getAIReply,
  buildFinalSystemPrompt,
};
