#!/usr/bin/env node

/**
 * Live LLM intent classification audit — requires OPENAI_API_KEY.
 * Results are informational (flaky by nature). Not a CI gate.
 *
 * Usage: node tests/audit/retrievalIntentAudit.live.js
 */

const path = require('path');
const dotenv = require(path.resolve(__dirname, '../../backend/node_modules/dotenv'));

dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const memoryService = require('../../backend/src/services/memoryService');

const buildRetrievalPlan = memoryService.__test?.buildRetrievalPlan;

if (typeof buildRetrievalPlan !== 'function') {
  console.error('[RetrievalIntentAudit.live] Missing memoryService.__test.buildRetrievalPlan export');
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  console.error('[RetrievalIntentAudit.live] OPENAI_API_KEY not set, skipping');
  process.exit(0);
}

const cases = [
  { id: 'llm_dual_intent', query: '和老公吵架后一直失眠', expected: { primary: 'sleep_recovery', secondary: 'relationship_conversation' } },
  { id: 'llm_venting_not_action', query: '我和老板最近关系很紧绷，每次见到他都很压抑', expected: { primary: 'relationship_conversation', stance: 'venting' } },
  { id: 'llm_knowledge_request', query: '焦虑是什么', expected: { stance: 'asking_fact' } },
  { id: 'llm_no_false_positive', query: '妈妈买菜去了', expected: { primary: 'general_support' } },
  { id: 'llm_script_request', query: '我不知道怎么跟妈妈谈边界', expected: { primary: 'relationship_conversation', stance: 'seeking_action' } },
  { id: 'llm_strategy_not_script', query: '我该不该先和老板冷处理一下', expected: { primary: 'relationship_conversation' } },
];

(async () => {
  const results = [];
  for (const testCase of cases) {
    const plan = await buildRetrievalPlan({ query: testCase.query, mode: testCase.options?.mode || 'classic' });
    const checks = Object.entries(testCase.expected).map(([key, value]) => {
      const planKey = key === 'primary' ? 'intent' : key === 'secondary' ? 'secondaryIntent' : key === 'stance' ? 'userStance' : key;
      return plan[planKey] === value;
    });
    results.push({
      id: testCase.id,
      query: testCase.query,
      expected: testCase.expected,
      actual: { intent: plan.intent, secondary: plan.secondaryIntent, stance: plan.userStance, confidence: plan.intentConfidence, source: plan.intentSource },
      passed: checks.every(Boolean),
    });
  }

  const failures = results.filter((item) => !item.passed).length;

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    type: 'live_llm',
    passed: failures === 0,
    totalCases: results.length,
    failures,
    flaky_note: 'LLM results vary by model version, network, and load. Failures here are informational, not blocking.',
    cases: results,
  }, null, 2));

  // Exit 0 even on failures — this is informational, not a gate
  process.exit(0);
})();
