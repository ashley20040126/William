#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const {
  extractScheduleCandidates,
  extractScheduleCandidatesWithFallback,
  extractCandidatesForTurn,
} = require('../src/services/scheduleCandidateService');

async function main() {
  const originalPost = axios.post;
  try {
    const results = [];

    axios.post = async () => ({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              shouldCreate: false,
              decisionConfidence: 0.86,
              reason: 'vague_intent',
              candidates: [],
            }),
          },
        }],
      },
    });
    results.push(await runCase({
      id: 'llm_blocks_vague_today_ball',
      content: '我今天要打球。',
      expectedCount: 0,
    }));

    axios.post = async () => ({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              shouldCreate: true,
              decisionConfidence: 0.93,
              candidates: [{
                title: '打球',
                dateText: '今天',
                timeText: '下午3-5',
                location: '体育馆',
                participants: [],
                confidence: 0.9,
                isSchedule: true,
              }],
            }),
          },
        }],
      },
    });
    results.push(await runCase({
      id: 'llm_allows_detailed_ball',
      content: '我今天下午3-5要去体育馆打球。',
      expectedCount: 1,
      expectedTitle: '打球',
    }));

    axios.post = async () => {
      throw new Error('synthetic_network_error');
    };
    results.push(await runCase({
      id: 'fallback_blocks_vague_today_ball',
      content: '我今天要打球。',
      expectedCount: 0,
    }));
    results.push(await runCase({
      id: 'fallback_allows_detailed_ball',
      content: '我今天下午3-5要去体育馆打球。',
      expectedCount: 1,
    }));
    results.push(await runCase({
      id: 'fallback_allows_same_day_coffee_without_today_word',
      content: '帮我加入日程，我上午10准备去咖啡馆喝咖啡。',
      expectedCount: 1,
      expectedTitle: '喝咖啡',
    }));
    results.push(await runCase({
      id: 'fallback_allows_meridiem_hour_without_dian',
      content: '上午10准备去咖啡馆喝咖啡。',
      expectedCount: 1,
      expectedTitle: '喝咖啡',
    }));
    results.push(await runContextCase({
      id: 'contextual_completion_merges_sport_name',
      previous: '下午3点要去体育馆打球。',
      current: '羽毛球，帮我加入日程',
      expectedCount: 1,
      expectedTitle: '打羽毛球',
    }));
    results.push(await runCase({
      id: 'fallback_allows_doctor_visit',
      content: '明天去复诊。',
      expectedCount: 1,
    }));
    results.push(await runCase({
      id: 'fallback_blocks_wishful_sports',
      content: '我这周想找时间运动一下。',
      expectedCount: 0,
    }));
    results.push(await runCase({
      id: 'fallback_blocks_hypothetical',
      content: '如果明天去打球会不会更好？',
      expectedCount: 0,
    }));
    results.push({
      id: 'rules_only_reference',
      content: '我今天要打球。',
      rulesOnlyCount: extractScheduleCandidates({ content: '我今天要打球。' }).length,
    });

    const failures = results.filter((item) => item.passed === false).length;
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      passed: failures === 0,
      totalCases: results.filter((item) => Object.prototype.hasOwnProperty.call(item, 'passed')).length,
      failures,
      cases: results,
    }, null, 2));

    if (failures > 0) {
      process.exitCode = 1;
    }
  } finally {
    axios.post = originalPost;
  }
}

async function runCase({ id, content, expectedCount, expectedTitle = '' }) {
  const candidates = await extractScheduleCandidatesWithFallback({ content, now: new Date('2026-03-25T10:00:00+08:00') });
  const titles = candidates.map((item) => item.title);
  const passed = candidates.length === expectedCount && (!expectedTitle || titles.includes(expectedTitle));
  return {
    id,
    content,
    count: candidates.length,
    titles,
    passed,
  };
}

async function runContextCase({ id, previous, current, expectedCount, expectedTitle = '' }) {
  const result = await extractCandidatesForTurn({
    previousUserContent: previous,
    content: current,
    now: new Date('2026-03-25T10:00:00+08:00'),
  });
  const titles = result.candidates.map((item) => item.title);
  const passed = result.candidates.length === expectedCount && (!expectedTitle || titles.includes(expectedTitle));
  return {
    id,
    previous,
    current,
    count: result.candidates.length,
    titles,
    source: result.source,
    passed,
  };
}

main().catch((error) => {
  console.error('[ScheduleAudit] Failed:', error);
  process.exit(1);
});
