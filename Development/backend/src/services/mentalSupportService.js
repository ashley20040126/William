const { fetchSupportGuidance } = require('./ragService');

async function buildSupportGuidance({
  query,
  memoryContext = '',
  recentMessages = [],
  retrievalIntent = 'general_support',
  userStance = 'neutral',
}) {
  return fetchSupportGuidance({
    query,
    memoryContext,
    recentMessages,
    retrievalIntent,
    userStance,
  });
}

module.exports = {
  buildSupportGuidance,
};
