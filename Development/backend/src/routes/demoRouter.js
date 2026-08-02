/**
 * Demo Mode Router
 * ────────────────
 * 仅在 DEMO_MODE=true 时生效，挂载在真实路由之前。
 * 拦截关键 API 并返回脚本化的演示数据，不读写生产 DB 数据。
 *
 * 演示场景：
 *  - 早晨情绪低落  → Classic / Expert 不同回应 + 推荐练习卡片
 *  - 人生意义提问  → Classic / Expert 差异化深度回答
 *  - 关闭持续监听  → 生成 PeetU 语音洞察 + 触发 Today 页刷新
 *  - Today 日程展示 → 返回多条已确认日程
 *  - 默认通用回复  → 温暖的兜底回应
 */

'use strict';

const { Router } = require('express');
const { auth } = require('../middleware/auth');
const db = require('../utils/db');

const router = Router();

// ── Per-user demo state (内存级，重启后重置) ────────────────────────────────
const demoAmbientFinalized = new Set(); // userId → boolean

// ── Helpers ────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayAt(hour, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${todayStr()} ${hh}:${mm}:00`;
}

async function getUserVoiceMode(userId) {
  try {
    const [rows] = await db.query('SELECT voice_mode FROM users WHERE id = ? LIMIT 1', [userId]);
    return String(rows[0]?.voice_mode || 'classic');
  } catch {
    return 'classic';
  }
}

async function getUserName(userId) {
  try {
    const [rows] = await db.query('SELECT name FROM users WHERE id = ? LIMIT 1', [userId]);
    return String(rows[0]?.name || '你');
  } catch {
    return '你';
  }
}

function detectScenario(content) {
  const text = String(content || '').toLowerCase();
  const meaningKw = ['人生的意义', '活着的意义', '生命的意义', '意义是什么', '为什么活', '人生意义', '生命意义', '意义何在', '有什么意义'];
  const emotionalKw = ['心情不好', '心情差', '心情很差', '情绪不好', '情绪差', '压力大', '好累', '好烦', '好难熬', '难受', '难过', '焦虑', '睡不着', '失眠', '烦躁', '心情', '压力', '情绪', '不好'];
  if (meaningKw.some((k) => text.includes(k))) return 'meaning';
  if (emotionalKw.some((k) => text.includes(k))) return 'emotional';
  return 'default';
}

const DEMO_SESSION_ID = 'demo_session_001';

// ── Practice suggestions ────────────────────────────────────────────────────

function buildPracticeClassicMorning() {
  const today = todayStr();
  return [
    {
      id: 'demo:p1',
      rawId: null,
      title: '*晨间正念呼吸：用5分钟腹式深呼吸，让身心从焦虑状态平稳过渡',
      description: '找一个安静角落，闭眼，吸气4秒 → 屏气4秒 → 呼气4秒，重复5次',
      recommendedTime: '早晨',
      actionPrompt: '腹式呼吸：手放腹部，吸气时腹部隆起，呼气时腹部收缩，专注感受气流',
      status: 'pending',
      completedAt: null,
      saved: false,
      suggestionDate: today,
    },
    {
      id: 'demo:p2',
      rawId: null,
      title: '*轻松的运动：可以选择散步或简单的拉伸，帮助唤醒身体',
      description: '离开屏幕10-15分钟，走到室外，感受自然光线和空气',
      recommendedTime: '中午',
      actionPrompt: '不戴耳机散步，专注脚踩地的感觉，让思绪自然流动',
      status: 'pending',
      completedAt: null,
      saved: false,
      suggestionDate: today,
    },
    {
      id: 'demo:p3',
      rawId: null,
      title: '*写下感受：在纸上记录下你的感受，释放一些负面情绪',
      description: '用5分钟写下：今天最难的是___，但我感谢的是___',
      recommendedTime: '中午',
      actionPrompt: '不需要写得好，随手写下脑子里第一个冒出来的想法就够了',
      status: 'pending',
      completedAt: null,
      saved: false,
      suggestionDate: today,
    },
  ];
}

function buildPracticeExpertMorning() {
  const today = todayStr();
  return [
    {
      id: 'demo:e1',
      rawId: null,
      title: '*认知重构练习：写下一个困扰你的自动化想法，寻找3个反例',
      description: '识别负性自动化思维是CBT的第一步——意识到它，才能改变它',
      recommendedTime: '早晨',
      actionPrompt: '格式：我的想法是"___"，但事实上的反例是：1. ___ 2. ___ 3. ___',
      status: 'pending',
      completedAt: null,
      saved: false,
      suggestionDate: today,
    },
    {
      id: 'demo:e2',
      rawId: null,
      title: '*渐进性肌肉放松：从脚趾到头顶逐步收紧再放松，打破躯体紧绷循环',
      description: '基于Jacobson放松技术，通过躯体路径降低交感神经系统激活水平',
      recommendedTime: '中午',
      actionPrompt: '每组肌肉紧绷5秒，放松30秒，从脚趾 → 小腿 → 大腿 → 腹部 → 手 → 肩 → 面部',
      status: 'pending',
      completedAt: null,
      saved: false,
      suggestionDate: today,
    },
    {
      id: 'demo:e3',
      rawId: null,
      title: '*情绪调节日记：用0-10分记录情绪强度，识别情绪触发因素',
      description: '情绪量化是情绪调节治疗（ERT）的核心工具，帮助建立情绪自我觉察',
      recommendedTime: '晚上',
      actionPrompt: '记录格式：事件 → 情绪类型 → 强度(0-10) → 身体感受 → 我的应对方式',
      status: 'pending',
      completedAt: null,
      saved: false,
      suggestionDate: today,
    },
  ];
}

// ── Chat responses ──────────────────────────────────────────────────────────

function buildClassicEmotionalReply(name) {
  return `我在这里，听你说。

今天感觉不好，这很正常——情绪不是开关，不是说"该好了"就能切换的。

你能告诉我，是什么让今天特别沉吗？是昨晚没睡好，还是有什么事情压在心里？

我给你安排了今天的三个小任务，不是为了"解决问题"，而是给你的身体和心一点喘息的空间——你不需要做完全部，选一个你觉得能做到的就够了。`;
}

function buildExpertEmotionalReply(name) {
  return `从认知行为的角度来看，你描述的情绪体验涉及几个值得关注的模式。

情绪低落往往与我们内心的**自动化负性思维**有关——这些想法在意识层面之下运作，持续影响情绪和行为反应。

我想先问你：当你说"心情很差"的时候，你脑子里有没有反复出现的念头？比如"我不够好"、"今天肯定会很糟"，或者对某件具体事情的预期性焦虑？

识别这些认知模式是干预的第一步。基于你目前的状态，我为你设计了几个有循证支持的练习——每一个都有对应的心理学机制：`;
}

function buildClassicMeaningReply() {
  return `人生的意义……这是个凌晨三点才会出现的问题。你能问出来，说明你其实在认真感受自己的生命。

我不想给你一个哲学课的答案。

我想问你：你上一次觉得"活着挺好的"是什么时候？不需要是大事——可能只是一杯咖啡的温度，或者某个人笑起来的样子。

意义不是找来的。它是在一个个具体的瞬间里，被你注意到的。

你今晚是怎么了？`;
}

function buildExpertMeaningReply() {
  return `这是存在主义心理学的核心议题。

维克多·弗兰克尔在经历集中营的极端苦难后得出结论：**意义不是被"发现"的，而是被"创造"的**——它存在于我们选择如何回应生活给我们的处境这件事本身之中。

从心理学角度，对意义的追问通常出现在三种情境：重大人生转折点、慢性压力积累后的耗竭感、或是深夜孤独时的存在性焦虑。

你现在的提问，属于哪种情境？

我们可以从三个维度来探索你个人的意义感来源：

**创造性意义**——你为世界或他人贡献了什么，哪怕很微小？
**体验性意义**——什么让你感到真实、在场、有价值？
**态度性意义**——面对无法改变的处境，你选择什么姿态？

弗兰克尔说：即便在最黑暗的地方，人仍然保有最后一种自由——选择自己对处境的态度。

告诉我，你在哪里感受到了这种意义的空缺？`;
}

function buildDefaultClassicReply() {
  return `我在听。

你今天怎么样？想聊聊正在经历什么吗——不管是大事还是只是一个感受，都可以。`;
}

function buildDefaultExpertReply() {
  return `我理解你。

从心理健康的角度，定期表达内心状态本身就是一种有益的心理调节方式。

你今天有什么想和我探讨的吗？`;
}

// ── Response builders ───────────────────────────────────────────────────────

function buildChatResponse({ content, voiceMode, now, sessionId }) {
  const scenario = detectScenario(content);
  const isExpert = voiceMode === 'direct';

  let replyText;
  let practiceSuggestions = [];

  if (scenario === 'emotional') {
    replyText = isExpert ? buildExpertEmotionalReply() : buildClassicEmotionalReply();
    practiceSuggestions = isExpert ? buildPracticeExpertMorning() : buildPracticeClassicMorning();
  } else if (scenario === 'meaning') {
    replyText = isExpert ? buildExpertMeaningReply() : buildClassicMeaningReply();
  } else {
    replyText = isExpert ? buildDefaultExpertReply() : buildDefaultClassicReply();
  }

  return {
    reply: replyText,
    sessionId: sessionId || DEMO_SESSION_ID,
    userMessage: {
      role: 'user',
      content,
      ts: now,
      scheduleCandidates: [],
    },
    assistantMessage: {
      role: 'assistant',
      content: replyText,
      ts: new Date(Date.now() + 800).toISOString(),
      practiceSuggestions,
      scheduleCandidates: [],
    },
  };
}

function buildVoiceInsight() {
  const today = todayStr();
  return {
    date: today,
    severity: 'warning',
    sampleCount: 8,
    transcriptTokens: 1240,
    averageStress: 6.8,
    highStressWindowCount: 2,
    highStressWindows: ['10:30', '14:15'],
    stabilityAverage: 4.2,
    yesterdayStabilityAverage: 5.1,
    stabilityDelta: -0.9,
    stabilityDirection: 'lower',
    speakingStyle: 'talkative',
    dominantEmotion: '焦虑',
    customNoticeText: '刚刚从后台音频中检测到了较大声音波动，似乎有激烈的争吵，你的情绪很激动，愿意和我说说发生了什么吗？',
  };
}

function buildTodayFeed(withVoiceInsight = false) {
  const today = todayStr();
  const hour = new Date().getHours();
  const timeSlot = hour < 12 ? 'morning' : hour < 18 ? 'midday' : 'evening';

  return {
    greeting: timeSlot === 'morning' ? '早安，今天我们一起来。' : timeSlot === 'midday' ? '午后好，休息一下再出发。' : '今天辛苦了，一起复盘这一天。',
    timeSlot,
    insight: {
      title: '情绪压力信号',
      detail: '你最近的情绪模式显示压力持续偏高，今天可以尝试几个简单的放松练习。',
      type: 'warning',
      severity: 'warning',
    },
    practiceReason: '今天的练习计划专为缓解压力和焦虑设计',
    focusChallenge: '工作与情绪平衡',
    topTrigger: '工作截止日期',
    patterns: [{ type: 'stress', detail: '下午14:00-16:00是你的高压窗口' }],
    journeyProgress: null,
    voiceInsight: withVoiceInsight ? buildVoiceInsight() : null,
    monthlyPaths: [
      {
        id: 'demo-path-1',
        templateId: 'stress-recovery',
        title: '压力恢复之旅',
        summary: '通过每日小练习建立情绪缓冲，让压力不再积累',
        stressSource: '工作压力',
        badgeId: 'calm-warrior',
        badgeLabel: '平静勇士',
        status: 'active',
        icon: '🌿',
        gradient: ['#6B8FFF', '#A78BFA'],
        completedAt: null,
        progress: { completed: 3, total: 7 },
        nextTask: '今日正念呼吸练习',
        tasks: [],
      },
    ],
    practiceTodos: [
      {
        id: `demo-todo-1-${today}`,
        title: '晨间正念呼吸',
        description: '用5分钟做腹式深呼吸，让身心从睡眠状态平稳过渡到清醒',
        sourceType: 'ai_suggestion',
        sourceLabel: 'AI 建议',
        typeLabel: '冥想',
        status: 'pending',
        completedAt: null,
        timeLabel: '早晨',
        pathId: null,
        pathTitle: null,
        actionPrompt: '吸气4秒 → 屏气4秒 → 呼气4秒，重复5次',
      },
      {
        id: `demo-todo-2-${today}`,
        title: '10分钟户外散步',
        description: '离开屏幕，走到室外，让自然光线帮助调整状态',
        sourceType: 'ai_suggestion',
        sourceLabel: 'AI 建议',
        typeLabel: '运动',
        status: 'pending',
        completedAt: null,
        timeLabel: '下午',
        pathId: null,
        pathTitle: null,
        actionPrompt: '不戴耳机，专注感受脚踩地的感觉和周围声音',
      },
      {
        id: `demo-todo-3-${today}`,
        title: '睡前情绪日记',
        description: '用3-5分钟写下今天让你压力最大的事，以及一件值得感谢的事',
        sourceType: 'ai_suggestion',
        sourceLabel: 'AI 建议',
        typeLabel: '日记',
        status: 'pending',
        completedAt: null,
        timeLabel: '晚上',
        pathId: null,
        pathTitle: null,
        actionPrompt: '今天最难的是___，但我感谢的是___',
      },
    ],
    badges: [],
    pathReviewBanner: null,
  };
}

function buildDemoConfirmedCandidates() {
  const today = todayStr();
  return [
    {
      id: 9001, sourceMessageId: null,
      title: '晨间正念呼吸',
      startTime: todayAt(8, 0), endTime: todayAt(8, 30),
      dateText: '今天早上8:00', location: '', participants: [], confidence: 0.95,
      status: 'confirmed',
      meta: { parsedDate: today, dateInfo: { date: todayAt(8, 0) } },
      createdAt: null, updatedAt: null, confirmedAt: null, dismissedAt: null,
    },
    {
      id: 9002, sourceMessageId: null,
      title: '与产品团队同步会议',
      startTime: todayAt(10, 30), endTime: todayAt(11, 30),
      dateText: '今天上午10:30', location: '会议室A', participants: ['产品团队'], confidence: 0.92,
      status: 'confirmed',
      meta: { parsedDate: today, dateInfo: { date: todayAt(10, 30) } },
      createdAt: null, updatedAt: null, confirmedAt: null, dismissedAt: null,
    },
    {
      id: 9003, sourceMessageId: null,
      title: '午间散步放松',
      startTime: todayAt(12, 30), endTime: todayAt(13, 0),
      dateText: '今天中午12:30', location: '公司附近', participants: [], confidence: 0.88,
      status: 'confirmed',
      meta: { parsedDate: today, dateInfo: { date: todayAt(12, 30) } },
      createdAt: null, updatedAt: null, confirmedAt: null, dismissedAt: null,
    },
    {
      id: 9004, sourceMessageId: null,
      title: '深呼吸减压练习',
      startTime: todayAt(15, 0), endTime: todayAt(15, 20),
      dateText: '今天下午3:00', location: '', participants: [], confidence: 0.90,
      status: 'confirmed',
      meta: { parsedDate: today, dateInfo: { date: todayAt(15, 0) } },
      createdAt: null, updatedAt: null, confirmedAt: null, dismissedAt: null,
    },
    {
      id: 9005, sourceMessageId: null,
      title: '睡前情绪日记',
      startTime: todayAt(21, 30), endTime: todayAt(22, 0),
      dateText: '今晚9:30', location: '', participants: [], confidence: 0.91,
      status: 'confirmed',
      meta: { parsedDate: today, dateInfo: { date: todayAt(21, 30) } },
      createdAt: null, updatedAt: null, confirmedAt: null, dismissedAt: null,
    },
  ];
}

function buildDemoPendingCandidates() {
  const today = todayStr();
  return [
    {
      id: 9010, sourceMessageId: null,
      title: '冥想减压：让自己安静10分钟',
      startTime: null, endTime: null,
      dateText: '今天', location: '', participants: [], confidence: 0.82,
      status: 'candidate',
      meta: { parsedDate: today, dateInfo: { date: null } },
      createdAt: null, updatedAt: null, confirmedAt: null, dismissedAt: null,
    },
  ];
}

// ── Route interceptors ──────────────────────────────────────────────────────

// Chat message
router.post('/api/chat/message', auth, async (req, res) => {
  try {
    const content = String(req.body?.content || '');
    const voiceMode = await getUserVoiceMode(req.uid);
    const now = new Date().toISOString();
    const sessionId = String(req.body?.sessionId || DEMO_SESSION_ID);
    res.json(buildChatResponse({ content, voiceMode, now, sessionId }));
  } catch (err) {
    console.error('[Demo] Chat error:', err.message);
    res.status(500).json({ error: 'Demo chat error' });
  }
});

// Today feed
router.get('/api/user/today', auth, (req, res) => {
  const withVoice = demoAmbientFinalized.has(req.uid);
  res.json(buildTodayFeed(withVoice));
});

// Ambient finalize → generates PeetU noticed
router.post('/api/voice/ambient-listening-finalize', auth, (req, res) => {
  demoAmbientFinalized.add(req.uid);
  res.json({
    ok: true,
    created: true,
    assistantMessage: {
      role: 'assistant',
      content: '我注意到你今天有几段时间说话的节奏比较紧绷，下午两点前后听起来压力特别大。现在感觉怎么样？想聊聊今天发生了什么吗？',
      ts: new Date().toISOString(),
    },
    voiceInsight: buildVoiceInsight(),
    scheduleCandidates: [],
  });
});

// Schedule candidates list
router.get('/api/journey/schedule-candidates', auth, (req, res) => {
  const status = String(req.query.status || 'candidate');
  if (status === 'confirmed') {
    res.json(buildDemoConfirmedCandidates());
  } else {
    res.json(buildDemoPendingCandidates());
  }
});

// Confirm demo schedule candidate
router.post('/api/journey/schedule-candidates/:id/confirm', auth, (req, res) => {
  const id = Number(req.params.id);
  const all = [...buildDemoConfirmedCandidates(), ...buildDemoPendingCandidates()];
  const candidate = all.find((c) => c.id === id) || buildDemoConfirmedCandidates()[0];
  res.json({ ...candidate, id, status: 'confirmed' });
});

// Dismiss demo schedule candidate
router.post('/api/journey/schedule-candidates/:id/dismiss', auth, (req, res) => {
  const id = Number(req.params.id);
  res.json({ id, status: 'dismissed' });
});

// Practice suggestion confirm → always succeeds in demo
router.post('/api/user/practice-suggestions/confirm', auth, (req, res) => {
  const today = todayStr();
  res.json({
    id: `ai:demo:${Date.now()}`,
    rawId: null,
    title: String(req.body?.title || '练习'),
    description: String(req.body?.description || ''),
    recommendedTime: req.body?.recommendedTime || null,
    actionPrompt: req.body?.actionPrompt || null,
    status: 'pending',
    completedAt: null,
    saved: true,
    suggestionDate: today,
  });
});

// Stub: reset demo ambient state (useful during presentation to replay the ambient demo)
router.post('/api/demo/reset-ambient', auth, (req, res) => {
  demoAmbientFinalized.delete(req.uid);
  res.json({ ok: true });
});

module.exports = router;
