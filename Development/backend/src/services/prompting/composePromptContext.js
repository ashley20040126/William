const engine = require('../behaviorEngine');
const memory = require('../memoryService');
const attachmentService = require('../attachmentService');
const db = require('../../utils/db');
const { buildCoreRules } = require('./coreRules');
const { buildWilliamIdentity } = require('./williamIdentity');
const { buildExplicitProfileContext } = require('./explicitProfileContext');
const { buildStateProfileContext } = require('./stateProfileContext');
const { resolveWorkspaceContext, buildWorkspaceContext } = require('./workspaceContext');
const interventionService = require('../interventionService');

function safeParse(val, fallback) {
  if (!val) return fallback;
  if (typeof val !== 'string') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function normalizeProfiles(rows = []) {
  return rows.map((row) => {
    const profile = { ...row };
    ['chat_topics', 'chat_patterns', 'chat_emotions', 'journal_topics', 'journal_patterns', 'practices_done'].forEach((field) => {
      profile[field] = safeParse(row[field], []);
    });
    return profile;
  }).reverse();
}

async function composePromptContext({
  user,
  userId,
  sessionId,
  userMessageId,
  userContent = '',
  currentAttachmentContext = '',
  hasKnowledgeInput = false,
  disablePersistentMemory = false,
}) {
  const profilesResult = await db.execute(
    'SELECT * FROM day_profiles WHERE user_id = ? ORDER BY date DESC LIMIT 14',
    [userId]
  );
  const profiles = normalizeProfiles(profilesResult[0]);
  const longitudinal = engine.analyzeLongitudinal(profiles);
  const workspace = resolveWorkspaceContext({
    voiceMode: user.voice_mode || 'classic',
    hasKnowledgeInput,
  });

  const memoryContext = await memory.buildConversationContext({
    userId,
    sessionId,
    mode: user.voice_mode || 'classic',
    currentMessageId: userMessageId,
    disablePersistentMemory,
    queryText: userContent,
    hasKnowledgeInput,
  });
  const retrievalIntent = memoryContext?.retrievalPlan?.intent || (hasKnowledgeInput ? 'file_or_url_followup' : 'general_support');

  const [historicalAttachmentContext, interventionContext] = await Promise.all([
    attachmentService.buildAttachmentConversationContext({
      sessionId,
      beforeMessageId: userMessageId,
    }),
    interventionService.buildInterventionEfficacyContext({ userId, intent: retrievalIntent }),
  ]);

  const explicitProfileOptions = resolveExplicitProfileOptions(retrievalIntent);
  const stateProfileOptions = resolveStateProfileOptions(retrievalIntent);

  const systemPromptSections = [
    buildCoreRules({ workspaceId: workspace.id }),
    buildWilliamIdentity({ user, workspace }),
    buildWorkspaceContext(workspace),
    buildExplicitProfileContext(user, explicitProfileOptions),
    buildStateProfileContext({ profiles, longitudinal }, stateProfileOptions),
    interventionContext.section,
  ].filter(Boolean);

  return {
    workspace,
    profiles,
    longitudinal,
    systemPromptSections,
    systemPrompt: systemPromptSections.join('\n\n'),
    conversationContext: {
      ...memoryContext,
      retrievalIntent,
      attachmentContext: [currentAttachmentContext, historicalAttachmentContext].filter(Boolean).join('\n\n'),
      interventionOverview: interventionContext.overview,
    },
  };
}

function resolveExplicitProfileOptions(retrievalIntent = 'general_support') {
  if (retrievalIntent === 'general_support') {
    return {
      compact: true,
      includeBio: false,
      includeChallenges: false,
      includeTriggers: false,
      includeScores: false,
    };
  }

  if (['file_or_url_followup', 'memory_audit', 'schedule_logistics', 'active_problem_solving', 'relationship_conversation'].includes(retrievalIntent)) {
    return {
      compact: true,
      includeBio: false,
      includeChallenges: ['active_problem_solving', 'relationship_conversation'].includes(retrievalIntent),
      includeTriggers: false,
      includeScores: ['active_problem_solving', 'relationship_conversation'].includes(retrievalIntent),
    };
  }

  return {};
}

function resolveStateProfileOptions(retrievalIntent = 'general_support') {
  if (['file_or_url_followup', 'memory_audit', 'schedule_logistics'].includes(retrievalIntent)) {
    return { disabled: true, emptyMessage: '' };
  }

  if (retrievalIntent === 'general_support') {
    return { compact: true };
  }

  if (['active_problem_solving', 'relationship_conversation'].includes(retrievalIntent)) {
    return { compact: true };
  }

  return {};
}

module.exports = {
  composePromptContext,
};
