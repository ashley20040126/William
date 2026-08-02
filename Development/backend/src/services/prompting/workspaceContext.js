const WORKSPACES = {
  william_chat: {
    id: 'william_chat',
    label: 'William Classic',
    instruction: '把重点放在陪伴、承接、梳理和轻推进上，不要过度职业化或像客服。',
  },
  digital_expert: {
    id: 'digital_expert',
    label: 'Digital Expert',
    instruction: '把重点放在分析、拆解、下一步行动和专业判断上，减少情绪化铺垫。',
  },
  attachment_review: {
    id: 'attachment_review',
    label: 'Attachment Review',
    instruction: '当前轮包含文件或链接，优先引用知识上下文，不清楚就明确说不清楚。',
  },
};

function resolveWorkspaceContext({ voiceMode = 'classic', hasKnowledgeInput = false } = {}) {
  if (voiceMode === 'direct') {
    return WORKSPACES.digital_expert;
  }
  if (hasKnowledgeInput) {
    return WORKSPACES.attachment_review;
  }
  return WORKSPACES.william_chat;
}

function buildWorkspaceContext(workspace) {
  return [
    '【工作区规则】',
    `- 当前工作区：${workspace.label}`,
    `- 工作区目标：${workspace.instruction}`,
  ].join('\n');
}

module.exports = {
  resolveWorkspaceContext,
  buildWorkspaceContext,
};
