#!/usr/bin/env node

/**
 * Deterministic intent classification audit — rule-based only, no LLM calls.
 * Safe to run in CI as a stable regression baseline.
 */

const path = require('path');
const dotenv = require(path.resolve(__dirname, '../../backend/node_modules/dotenv'));

dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const memoryService = require('../../backend/src/services/memoryService');

const detectRetrievalIntent = memoryService.__test?.detectRetrievalIntent;

if (typeof detectRetrievalIntent !== 'function') {
  console.error('[RetrievalIntentAudit] Missing memoryService.__test.detectRetrievalIntent export');
  process.exit(1);
}

const cases = [
  { id: 'file_followup_from_query', query: '你先看这个文件，然后告诉我重点。', expected: { primary: 'file_or_url_followup' } },
  { id: 'file_followup_from_knowledge_flag', query: '这个主要讲了什么？', options: { hasKnowledgeInput: true }, expected: { primary: 'file_or_url_followup' } },
  { id: 'memory_audit', query: '你还记得我之前说过什么吗？', expected: { primary: 'memory_audit', stance: 'checking_memory' } },
  { id: 'schedule_logistics', query: '我明天要去复诊，帮我看看安排。', expected: { primary: 'schedule_logistics' } },
  { id: 'sleep_recovery', query: '最近总是早醒，睡不好。', expected: { primary: 'sleep_recovery' } },
  { id: 'relationship_conversation', query: '我不知道怎么跟老板开口说这件事。', expected: { primary: 'relationship_conversation' } },
  { id: 'active_problem_solving', query: '别安慰我，直接说下一步怎么做。', expected: { primary: 'active_problem_solving', stance: 'seeking_action' } },
  { id: 'active_problem_solving_direct_mode', query: '帮我梳理一下这个问题。', options: { mode: 'direct' }, expected: { primary: 'active_problem_solving' } },
  { id: 'emotional_support', query: '我现在很焦虑，快撑不住了。', expected: { primary: 'emotional_support' } },
  { id: 'general_support', query: '今天过得一般般。', expected: { primary: 'general_support' } },
  { id: 'venting_stance', query: '我就是随便吐槽一下今天的会。', expected: { stance: 'venting' } },
  { id: 'knowledge_not_emotional', query: '给我一个焦虑研究的论文摘要。', expected: { stance: 'asking_fact' } },
  { id: 'no_false_positive_relationship', query: '妈妈买菜去了', expected: { primary: 'general_support' } },
  { id: 'relationship_venting_fallback', query: '我和老板最近关系很紧绷，每次见到他都很压抑', expected: { primary: 'relationship_conversation', stance: 'venting' } },
];

const results = cases.map((testCase) => {
  const actual = detectRetrievalIntent(testCase.query, testCase.options || {});
  const checks = Object.entries(testCase.expected).map(([key, value]) => actual[key] === value);
  return {
    id: testCase.id,
    query: testCase.query,
    expected: testCase.expected,
    actual: { primary: actual.primary, secondary: actual.secondary, stance: actual.stance, confidence: actual.confidence },
    passed: checks.every(Boolean),
  };
});

const failures = results.filter((item) => !item.passed).length;

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  type: 'deterministic',
  passed: failures === 0,
  totalCases: results.length,
  failures,
  cases: results,
}, null, 2));

if (failures > 0) {
  process.exitCode = 1;
}
process.exit(process.exitCode || 0);
