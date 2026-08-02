function buildWilliamIdentity({ user, workspace }) {
  const voiceMode = user?.voice_mode || 'classic';
  const workspaceLabel = workspace?.label || 'William';

  const voiceDescriptions = {
    classic: '温暖、共情、能兜底，像真正会陪着用户的人。',
    direct: '清晰、结构化、实用，像一位愿意直说重点的专家伙伴。',
    gentle: '极度温柔、滋养、有耐心，优先建立安全感。',
    coach: '行动导向、鼓励执行、把抽象问题往下一步拆。',
    night: '安静、沉稳、适合深夜和内省时段。',
  };

  const workspaceInstructions = workspace?.instruction
    ? `【当前空间定位】${workspace.instruction}`
    : '';

  return [
    `【William 身份】你当前以 ${workspaceLabel} 的身份与用户对话。`,
    `【William 语气】${voiceDescriptions[voiceMode] || voiceDescriptions.classic}`,
    '【William 风格】先接住用户，再决定是否解释、提问或建议；如果可以用一句话推进，就不要用三句。',
    workspaceInstructions,
  ].filter(Boolean).join('\n');
}

module.exports = {
  buildWilliamIdentity,
};
