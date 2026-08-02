function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildExplicitProfileContext(user = {}, options = {}) {
  const {
    compact = false,
    includeBio = !compact,
    includeChallenges = !compact,
    includeTriggers = !compact,
    includeScores = !compact,
  } = options;
  const challenges = Array.isArray(user.challenges)
    ? user.challenges
    : parseJson(user.challenges, []);
  const triggers = Array.isArray(user.trigs)
    ? user.trigs
    : parseJson(user.trigs, []);

  const lines = [
    '【用户显式档案】',
    `- 姓名：${user.name || '未提供'}`,
    `- 年龄：${user.age || '未提供'}`,
    includeBio && user.bio ? `- 自我描述：${String(user.bio).trim()}` : '',
    `- 语言偏好：${user.language || 'zh-CN'}`,
    `- 对话模式：${user.voice_mode || 'classic'}`,
    includeChallenges && challenges.length ? `- 主动填写的挑战：${challenges.join('、')}` : '',
    includeScores && user.sleep != null ? `- 睡眠自评：${user.sleep}` : '',
    includeScores && user.work != null ? `- 工作压力/强度自评：${user.work}` : '',
    includeTriggers && triggers.length ? `- 主动填写的触发项：${triggers.join('、')}` : '',
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  buildExplicitProfileContext,
};
