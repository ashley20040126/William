#!/usr/bin/env node

const path = require('path');
const dotenv = require(path.resolve(__dirname, '../../backend/node_modules/dotenv'));

dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const interventionService = require('../../backend/src/services/interventionService');

const detectInterventionsFromReply = interventionService.__test?.detectInterventionsFromReply;
const detectChatFollowupSignal = interventionService.__test?.detectChatFollowupSignal;

if (typeof detectInterventionsFromReply !== 'function' || typeof detectChatFollowupSignal !== 'function') {
  console.error('[InterventionSignalsAudit] Missing interventionService __test exports');
  process.exit(1);
}

const replyCases = [
  {
    id: 'no_sleep_reset_for_generic_rest',
    input: { reply: '今晚好好休息，明天再看也来得及。', userContent: '今天有点累。', activeLoops: [] },
    expectedTypes: [],
  },
  {
    id: 'no_breathing_for_breath_question',
    input: { reply: '你现在呼吸怎么样？我们先看看身体感受。', userContent: '我有点紧。', activeLoops: [] },
    expectedTypes: [],
  },
  {
    id: 'no_boundary_for_generic_boundary_word',
    input: { reply: '这个话题有点超出我的能力边界，我先不乱判断。', userContent: '那你先别分析。', activeLoops: [] },
    expectedTypes: [],
  },
  {
    id: 'breathing_positive',
    input: { reply: '先吸气四拍，再慢慢吐气六拍，我们只做这一轮。', userContent: '我现在很慌。', activeLoops: [] },
    expectedTypes: ['breathing'],
  },
  {
    id: 'sleep_reset_positive',
    input: { reply: '今晚先别继续刷手机，去躺下，别看时间，只把呼吸放慢一点。', userContent: '我又失眠了。', activeLoops: [] },
    expectedTypes: ['sleep_reset'],
  },
  {
    id: 'boundary_positive',
    input: { reply: '你可以不答应，先不用现在承诺，先回到你的节奏里。', userContent: '我不知道要不要立刻答应她。', activeLoops: [] },
    expectedTypes: ['boundary_prompt'],
  },
  {
    id: 'script_positive',
    input: { reply: '你可以这样说：我这周想先缓一下，我们改天再聊这件事。', userContent: '我不知道怎么跟妈妈开口。', activeLoops: [] },
    expectedTypes: ['difficult_conversation_script'],
  },
];

const followupCases = [
  { id: 'reject_question_with_可以', content: '你可以帮我看看这个吗？', interventionType: 'task_breakdown', expected: null },
  { id: 'reject_question_with_行吗', content: '这样行吗？', interventionType: 'task_breakdown', expected: null },
  { id: 'explicit_accept', content: '好，我试试。', interventionType: 'task_breakdown', expected: 'explicit_accept' },
  { id: 'followthrough', content: '我刚刚发了。', interventionType: 'difficult_conversation_script', expected: 'behavior_followthrough' },
  { id: 'explicit_reject', content: '没啥用，我做不到。', interventionType: 'reframing', expected: 'explicit_reject' },
];

const replyResults = replyCases.map((testCase) => {
  const actualTypes = detectInterventionsFromReply(testCase.input).map((item) => item.interventionType).sort();
  const expectedTypes = [...testCase.expectedTypes].sort();
  return {
    id: testCase.id,
    expectedTypes,
    actualTypes,
    passed: JSON.stringify(actualTypes) === JSON.stringify(expectedTypes),
  };
});

const followupResults = followupCases.map((testCase) => {
  const actual = detectChatFollowupSignal(String(testCase.content || '').trim().toLowerCase(), testCase.interventionType);
  return {
    id: testCase.id,
    expected: testCase.expected,
    actual: actual ? actual.acceptedSignal : null,
    passed: (actual ? actual.acceptedSignal : null) === testCase.expected,
  };
});

const failures = [...replyResults, ...followupResults].filter((item) => !item.passed).length;

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  passed: failures === 0,
  totals: {
    replyCases: replyResults.length,
    followupCases: followupResults.length,
    failures,
  },
  replies: replyResults,
  followups: followupResults,
}, null, 2));

if (failures > 0) {
  process.exitCode = 1;
}
