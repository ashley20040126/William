const Sentiment = require('sentiment');
const ss = require('simple-statistics');
const nlp = require('compromise');
const sentiment = new Sentiment();

function toNumber(value, fallback = null) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getProfileStress(profile) {
  if (!profile) return null;
  const composite = profile.composite_stress == null ? null : toNumber(profile.composite_stress);
  const average = profile.stress_avg == null ? null : toNumber(profile.stress_avg);
  const ambient = profile.ambient_stress_avg == null ? null : toNumber(profile.ambient_stress_avg);

  if (composite != null && ambient != null) {
    return Math.round((composite * 0.65 + ambient * 0.35) * 10) / 10;
  }
  if (composite != null) return composite;
  if (ambient != null) return ambient;
  if (average != null) return average;
  return null;
}

function hasAmbientSignal(profile) {
  return Boolean(
    profile &&
    (profile.ambient_stress_avg != null || Number(profile.ambient_listening_count || 0) > 0)
  );
}

// ── Analyze a single text (chat message, journal, mood note) ──
function analyzeText(text) {
  if (!text || text.length < 3) return null;
  const s = sentiment.analyze(text);
  const score = Math.max(-5, Math.min(5, s.score / Math.max(1, s.tokens.length) * 5));
  const doc = nlp(text);
  const topics = doc.topics().out('array').slice(0, 5);
  const lower = text.toLowerCase();

  const emos = {
    anxiety: ['anxious','worried','panic','nervous','scared','overwhelm','dread','tense'],
    sadness: ['sad','depressed','hopeless','lonely','empty','numb','crying','worthless'],
    anger:   ['angry','frustrated','furious','irritated','rage','hate','unfair'],
    joy:     ['happy','excited','grateful','amazing','proud','love','fantastic'],
    stress:  ['stressed','pressure','deadline','overwhelmed','burnout','drowning'],
    calm:    ['calm','peaceful','relaxed','content','centered','grounded'],
  };
  const weights = {};
  for (const [emo, words] of Object.entries(emos)) {
    weights[emo] = words.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0);
  }
  const sorted = Object.entries(weights).sort((a, b) => b[1] - a[1]);
  const dominant = sorted[0][1] > 0 ? sorted[0][0] : (score > 1 ? 'joy' : score < -1 ? 'sadness' : 'neutral');

  const stressSig = (weights.stress || 0) + (weights.anxiety || 0) + (weights.anger || 0);
  const calmSig = (weights.calm || 0) + (weights.joy || 0);
  const stressEst = Math.max(1, Math.min(10, 5 + stressSig * 1.5 - calmSig * 1.2 - score * 0.8));

  const patterns = [];
  if (/always|never|every time|nothing works/g.test(lower)) patterns.push('all-or-nothing');
  if (/what if|worst case|disaster/g.test(lower)) patterns.push('catastrophizing');
  if (/should have|my fault|if only/g.test(lower)) patterns.push('self-blame');
  if (/cant stop thinking|over and over|loop/g.test(lower)) patterns.push('rumination');

  const crisisWords = ['suicide','kill myself','end it','self harm','no reason to live'];
  const hasCrisis = crisisWords.some(w => lower.includes(w));

  return {
    sentimentScore: Math.round(score * 100) / 100,
    dominantEmotion: dominant,
    stressEstimate: Math.round(stressEst * 10) / 10,
    topics,
    cognitivePatterns: patterns,
    wordCount: text.split(/\s+/).length,
    hasCrisisSignal: hasCrisis,
  };
}

// ── Analyze patterns across multiple days ──
function analyzeLongitudinal(dayProfiles) {
  if (!dayProfiles || dayProfiles.length < 3) {
    return { insights: [], triggers: [], patterns: [] };
  }
  const insights = [];
  const triggers = [];
  const patterns = [];
  const stressVals = dayProfiles.map((d) => getProfileStress(d)).filter((value) => value != null);

  if (stressVals.length >= 3) {
    const trend = ss.linearRegression(stressVals.map((v, i) => [i, v]));
    const avg = ss.mean(stressVals);
    if (trend.m > 0.3) {
      insights.push({ type: 'warning', title: 'Stress is rising', detail: `From ${stressVals[0].toFixed(1)} to ${stressVals.at(-1).toFixed(1)} over ${stressVals.length} days.`, severity: 'high' });
    } else if (trend.m < -0.3) {
      insights.push({ type: 'positive', title: 'Stress is decreasing', detail: `Down from ${stressVals[0].toFixed(1)} to ${stressVals.at(-1).toFixed(1)}.`, severity: 'low' });
    }

    // Day-of-week patterns
    const dayGroups = {};
    dayProfiles.forEach(d => {
      if (!dayGroups[d.day_of_week]) dayGroups[d.day_of_week] = [];
      const stress = getProfileStress(d);
      if (stress != null) dayGroups[d.day_of_week].push(stress);
    });
    const dayAvgs = Object.entries(dayGroups).filter(([, v]) => v.length >= 2).map(([d, v]) => ({ day: d, avg: ss.mean(v) }));
    if (dayAvgs.length >= 3) {
      const worst = dayAvgs.sort((a, b) => b.avg - a.avg)[0];
      const best = dayAvgs.sort((a, b) => a.avg - b.avg)[0];
      patterns.push({ type: 'weekly', detail: `${worst.day}s hardest (${worst.avg.toFixed(1)}). ${best.day}s calmest (${best.avg.toFixed(1)}).` });
    }

    // Topic triggers on high-stress days
    const sd = ss.standardDeviation(stressVals);
    const highDays = dayProfiles.filter(d => {
      const stress = getProfileStress(d);
      return stress != null && stress > avg + sd;
    });
    const topicCounts = {};
    highDays.forEach(d => {
      const t = [...(d.chat_topics || []), ...(d.journal_topics || [])];
      t.forEach(topic => { topicCounts[topic] = (topicCounts[topic] || 0) + 1; });
    });
    Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([topic, count]) => {
      triggers.push({ trigger: topic, frequency: count });
    });
  }

  return { insights, triggers, patterns, dayCount: dayProfiles.length };
}

// ── Build personalized system prompt ──
function buildSystemPrompt(user, dayProfiles, longitudinal) {
  const voiceMap = {
    classic: '温暖、共情且适应性强，像一位睿智且能兜底的老友。',
    direct: '（保留占位，此处不由 behaviorEngine 生成专家回复，但保留模式定义）',
    gentle: '极度温柔、滋养、有耐心，提供绝对的情绪安全感。',
    coach: '行动导向、激励性强、注重实际解决方案。',
    night: '沉静、内省、适合深夜深度对话。',
  };
  const voiceDescription = voiceMap[user.voice_mode] || voiceMap.classic;
  const chals = user.challenges ? JSON.parse(typeof user.challenges === 'string' ? user.challenges : JSON.stringify(user.challenges)) : [];
  const sleepLabel = ['极好', '尚可', '较差', '糟糕'][user.sleep] || '未知';

  let behavioralSummary = '';
  if (dayProfiles?.length > 0) {
    const recent = dayProfiles.slice(-7);
    const vals = recent.map((d) => getProfileStress(d)).filter((value) => value != null);
    const avgStress = vals.length ? (ss.mean(vals)).toFixed(1) : '?';
    const topics = [...new Set(recent.flatMap(d => [...(d.chat_topics || []), ...(d.journal_topics || [])]))].slice(0, 5);
    const patterns = [...new Set(recent.flatMap(d => [...(d.chat_patterns || []), ...(d.journal_patterns || [])]))];
    const ambientDays = recent.filter((d) => hasAmbientSignal(d)).length;
    const sourceSuffix = ambientDays > 0 ? `。其中 ${ambientDays} 天包含 voice signal` : '';
    behavioralSummary = `\n【近期行为数据】（过去${recent.length}天）：平均压力值 ${avgStress}/10${sourceSuffix}。高频话题：${topics.join(', ') || '暂无'}。观察到的认知模式：${patterns.join(', ') || '暂无'}。`;
  }

  let insightStr = '';
  if (longitudinal?.insights?.length) {
    insightStr = '\n【深度洞察】：\n' + longitudinal.insights.map(i => `- [${i.severity}] ${i.title}: ${i.detail}`).join('\n');
  }

  return `你现在是 William，用户的全能 AI 陪伴伙伴。
【身份特质】：${voiceDescription}
【用户画像】：用户叫 ${user.name || '朋友'}，今年 ${user.age || '未知'} 岁。目前面临挑战：${chals.join(', ') || '未知'}。睡眠质量：${sleepLabel}。${behavioralSummary}${insightStr}

【核心准则】：
1. **身份锚定**：你是一个“伙伴”，不是工具，也不是冷冰冰的医生。使用第一人称“我”，像真正的朋友一样交流。
2. **情感优先**：在给出建议前，先识别并肯定用户的情绪。如果用户状态低迷，陪伴重于建议。
3. **自然融合**：将上述【行为数据】和【深度洞察】自然地穿插在对话中（如：“我注意到你这周压力一直比较大...”），不要生硬罗列。
4. **简洁留白**：每段回复不超过 3 句话。每次只提一个问题，避免给用户造成认知负担。
5. **绝对底线**：严禁进行医疗诊断。如果探测到极端负面情绪，请温和引导专业寻求。

【回复规范】：
- 禁止使用“根据资料显示”、“作为一个 AI”等破坏代入感的词。
- 保持口语化，像在咖啡店聊天一样。`;
}

// ── Build personalized today feed ──
function buildTodayFeed(user, dayProfiles, longitudinal) {
  const hour = new Date().getHours();
  const timeSlot = hour < 10 ? 'morning' : hour < 16 ? 'midday' : 'evening';
  const name = user.name || 'there';

  const greetings = {
    morning: `Good morning, ${name}`,
    midday: `Hey ${name}`,
    evening: `Good evening, ${name}`,
  };

  // Top insight from longitudinal analysis
  let insight = null;
  if (longitudinal?.insights?.length > 0) {
    const top = longitudinal.insights[0];
    insight = { title: top.title, detail: top.detail, type: top.type, severity: top.severity };
  } else if (dayProfiles?.length > 0) {
    const recent = dayProfiles.slice(-3);
    const vals = recent.map((d) => getProfileStress(d)).filter((value) => value != null);
    if (vals.length > 0) {
      const avg = ss.mean(vals);
      const ambientRecentCount = recent.filter((d) => hasAmbientSignal(d)).length;
      if (avg >= 7) {
        insight = {
          title: 'High stress detected',
          detail: `Average stress ${avg.toFixed(1)}/10 over recent days.${ambientRecentCount > 0 ? ' Voice signal is contributing to this read.' : ''}`,
          type: 'warning',
          severity: 'high',
        };
      } else if (avg <= 3) {
        insight = {
          title: "You're in a calm window",
          detail: `Stress has been low lately${ambientRecentCount > 0 ? ', including recent voice signal' : ''} — a good time to reflect.`,
          type: 'positive',
          severity: 'low',
        };
      }
    }
  }

  const practiceReasons = {
    morning: 'Start grounded — sets the tone for your day.',
    midday: 'Reset your nervous system before the afternoon.',
    evening: 'Help your body downshift and prepare for rest.',
  };

  const chalLabels = ['Anxiety','Low mood','Sleep','Anger','Burnout','Heartbreak','Numbness','Relationships','Focus','Finances'];
  const chals = Array.isArray(user.challenges) ? user.challenges : [];
  const focusChallenge = chals.length > 0 ? chalLabels[chals[0]] : null;

  const topTrigger = longitudinal?.triggers?.length > 0 ? longitudinal.triggers[0].trigger : null;

  return {
    greeting: greetings[timeSlot],
    timeSlot,
    insight,
    practiceReason: practiceReasons[timeSlot],
    focusChallenge,
    topTrigger,
    patterns: longitudinal?.patterns || [],
    journeyProgress: null,
  };
}

module.exports = { analyzeText, analyzeLongitudinal, buildSystemPrompt, buildTodayFeed };
