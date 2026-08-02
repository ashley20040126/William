function toNumber(value, fallback = null) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getProfileStress(profile) {
  if (!profile) return null;
  const composite = profile.composite_stress == null ? null : toNumber(profile.composite_stress);
  const average = profile.stress_avg == null ? null : toNumber(profile.stress_avg);
  const ambient = profile.ambient_stress_avg == null ? null : toNumber(profile.ambient_stress_avg);

  if (composite != null && ambient != null) return Math.round((composite * 0.65 + ambient * 0.35) * 10) / 10;
  if (composite != null) return composite;
  if (ambient != null) return ambient;
  if (average != null) return average;
  return null;
}

function buildStateProfileContext({ profiles = [], longitudinal = null }, options = {}) {
  const {
    disabled = false,
    compact = false,
    emptyMessage = '【最近状态画像】暂无足够的近期行为数据，请更多依据当前输入判断。',
  } = options;
  if (disabled) {
    return '';
  }

  if (!Array.isArray(profiles) || profiles.length === 0) {
    return emptyMessage;
  }

  const recent = profiles.slice(-7);
  const stressValues = recent.map(getProfileStress).filter((value) => value != null);
  const avgStress = stressValues.length > 0
    ? (stressValues.reduce((sum, value) => sum + value, 0) / stressValues.length).toFixed(1)
    : '未知';
  const topics = [...new Set(recent.flatMap((profile) => [
    ...(Array.isArray(profile.chat_topics) ? profile.chat_topics : []),
    ...(Array.isArray(profile.journal_topics) ? profile.journal_topics : []),
  ]))].slice(0, 5);
  const patterns = [...new Set(recent.flatMap((profile) => [
    ...(Array.isArray(profile.chat_patterns) ? profile.chat_patterns : []),
    ...(Array.isArray(profile.journal_patterns) ? profile.journal_patterns : []),
  ]))].slice(0, 4);

  const longitudinalInsight = longitudinal?.insights?.[0]
    ? `- 首要趋势：${longitudinal.insights[0].title}；${longitudinal.insights[0].detail}`
    : '';
  const triggerSummary = longitudinal?.triggers?.length
    ? `- 高压触发主题：${longitudinal.triggers.slice(0, 3).map((item) => item.trigger).join('、')}`
    : '';
  const patternSummary = longitudinal?.patterns?.length
    ? `- 重复模式：${longitudinal.patterns.slice(0, 2).map((item) => item.detail).join('；')}`
    : '';

  const lines = [
    '【最近状态画像】',
    `- 近 7 天综合压力均值：${avgStress}${avgStress === '未知' ? '' : '/10'}`,
  ];

  if (!compact) {
    lines.push(
      topics.length ? `- 高频主题：${topics.join('、')}` : '',
      patterns.length ? `- 高频认知/行为模式：${patterns.join('、')}` : '',
      longitudinalInsight,
      triggerSummary,
      patternSummary,
    );
  } else {
    lines.push(longitudinalInsight, triggerSummary);
  }

  return lines.filter(Boolean).join('\n');
}

module.exports = {
  buildStateProfileContext,
};
