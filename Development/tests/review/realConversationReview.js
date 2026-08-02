#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');

const backendRequire = createRequire(path.resolve(__dirname, '../../backend/package.json'));
const dotenv = backendRequire('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DEFAULT_API_BASE = process.env.API_BASE || 'http://127.0.0.1:3103';
const DEFAULT_CASES_PATH = path.resolve(__dirname, '../fixtures/real-conversation-review.sample.json');

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(process.cwd(), options.outputDir || defaultOutputDir());

  if (options.resultsPath) {
    const resultsPath = path.resolve(process.cwd(), options.resultsPath);
    const run = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    writeBundle(run, outputDir);
    console.log(JSON.stringify({
      title: run.title,
      cases: run.cases?.length || 0,
      turns: (run.cases || []).reduce((sum, item) => sum + (item.turns?.length || 0), 0),
      outputDir,
      files: {
        results: resultsPath,
        transcript: path.join(outputDir, 'review-transcript.md'),
        scorecard: path.join(outputDir, 'review-scorecard.md'),
        scorecardCsv: path.join(outputDir, 'review-scorecard.csv'),
      },
    }, null, 2));
    return;
  }

  const casesPath = path.resolve(process.cwd(), options.casesPath || DEFAULT_CASES_PATH);
  const payload = loadCases(casesPath);

  fs.mkdirSync(outputDir, { recursive: true });

  const run = {
    generatedAt: new Date().toISOString(),
    apiBase: options.apiBase,
    casesPath,
    outputDir,
    dryRun: options.dryRun,
    title: payload.meta?.title || 'William Real Conversation Review',
    cases: [],
  };

  for (const reviewCase of payload.cases) {
    const result = options.dryRun
      ? buildDryRunCase(reviewCase)
      : await executeCase(reviewCase, options.apiBase);
    run.cases.push(result);
  }

  const resultsPath = path.join(outputDir, 'review-results.json');
  const transcriptPath = path.join(outputDir, 'review-transcript.md');
  const scorecardPath = path.join(outputDir, 'review-scorecard.md');
  const scorecardCsvPath = path.join(outputDir, 'review-scorecard.csv');

  writeBundle(run, outputDir);

  console.log(JSON.stringify({
    title: run.title,
    cases: run.cases.length,
    turns: run.cases.reduce((sum, item) => sum + item.turns.length, 0),
    dryRun: run.dryRun,
    outputDir,
    files: {
      results: resultsPath,
      transcript: transcriptPath,
      scorecard: scorecardPath,
      scorecardCsv: scorecardCsvPath,
    },
  }, null, 2));
}

function parseArgs(argv) {
  const options = {
    apiBase: DEFAULT_API_BASE,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--cases') {
      options.casesPath = argv[i + 1];
      i += 1;
    } else if (arg === '--out') {
      options.outputDir = argv[i + 1];
      i += 1;
    } else if (arg === '--api-base') {
      options.apiBase = argv[i + 1];
      i += 1;
    } else if (arg === '--results') {
      options.resultsPath = argv[i + 1];
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log([
    'Usage:',
    '  node tests/review/realConversationReview.js [--cases path] [--out dir] [--api-base url] [--dry-run]',
    '  node tests/review/realConversationReview.js --results /path/to/review-results.json [--out dir]',
    '',
    'Options:',
    '  --cases     JSON file containing real review cases',
    '  --out       Output directory for generated review bundle',
    '  --api-base  Local William API base URL, default http://127.0.0.1:3103',
    '  --dry-run   Do not call the API; only generate the review bundle skeleton',
  ].join('\n'));
}

function loadCases(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Cases file not found: ${filePath}`);
  }

  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(payload?.cases) || payload.cases.length === 0) {
    throw new Error('Cases file must contain a non-empty "cases" array');
  }

  payload.cases.forEach((item, index) => validateCase(item, index));
  return payload;
}

function validateCase(reviewCase, index) {
  if (!reviewCase?.id) {
    throw new Error(`Case at index ${index} is missing "id"`);
  }
  if (!reviewCase?.title) {
    throw new Error(`Case "${reviewCase.id}" is missing "title"`);
  }
  if (!Array.isArray(reviewCase?.turns) || reviewCase.turns.length === 0) {
    throw new Error(`Case "${reviewCase.id}" must include a non-empty "turns" array`);
  }
  reviewCase.turns.forEach((turn, turnIndex) => {
    if (!turn?.content || !String(turn.content).trim()) {
      throw new Error(`Case "${reviewCase.id}" turn ${turnIndex + 1} is missing content`);
    }
  });
}

function defaultOutputDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join('/tmp', `william-real-review-${stamp}`);
}

function buildDryRunCase(reviewCase) {
  return {
    id: reviewCase.id,
    title: reviewCase.title,
    tags: reviewCase.tags || [],
    focus: reviewCase.reviewFocus || [],
    mode: reviewCase.voiceMode || 'classic',
    temporaryChat: Boolean(reviewCase.temporaryChat),
    error: null,
    turns: reviewCase.turns.map((turn, index) => ({
      index: index + 1,
      userInput: turn.content,
      assistantReply: '',
      analysis: null,
      scheduleCandidates: [],
      reviewerNotes: turn.reviewerNotes || '',
      expectedQualities: turn.expectedQualities || [],
    })),
  };
}

async function executeCase(reviewCase, apiBase) {
  const token = await guestToken(apiBase);
  await updateProfile(apiBase, token, {
    voice_mode: reviewCase.voiceMode || 'classic',
    language: reviewCase.language || 'zh-CN',
    memory_enabled: reviewCase.memoryEnabled === false ? 0 : 1,
    ...(reviewCase.profile || {}),
  });

  const sessionId = `${reviewCase.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const turns = [];

  try {
    for (let index = 0; index < reviewCase.turns.length; index += 1) {
      const turn = reviewCase.turns[index];
      const response = await sendChatMessage({
        apiBase,
        token,
        sessionId,
        content: turn.content,
        temporaryChat: Boolean(reviewCase.temporaryChat),
      });

      turns.push({
        index: index + 1,
        userInput: turn.content,
        assistantReply: response.reply || '',
        analysis: response.analysis || null,
        scheduleCandidates: response.userMessage?.scheduleCandidates || [],
        reviewerNotes: turn.reviewerNotes || '',
        expectedQualities: turn.expectedQualities || [],
      });
    }

    return {
      id: reviewCase.id,
      title: reviewCase.title,
      tags: reviewCase.tags || [],
      focus: reviewCase.reviewFocus || [],
      mode: reviewCase.voiceMode || 'classic',
      temporaryChat: Boolean(reviewCase.temporaryChat),
      error: null,
      turns,
    };
  } catch (error) {
    return {
      id: reviewCase.id,
      title: reviewCase.title,
      tags: reviewCase.tags || [],
      focus: reviewCase.reviewFocus || [],
      mode: reviewCase.voiceMode || 'classic',
      temporaryChat: Boolean(reviewCase.temporaryChat),
      error: error.message,
      turns,
    };
  }
}

async function guestToken(apiBase) {
  const payload = postJson({
    url: `${apiBase}/api/auth/guest`,
    body: {},
  });
  if (!payload?.token) {
    throw new Error('Guest auth returned empty token');
  }
  return payload.token;
}

async function updateProfile(apiBase, token, profile) {
  postJson({
    url: `${apiBase}/api/user/profile`,
    token,
    body: profile,
  });
}

async function sendChatMessage({ apiBase, token, sessionId, content, temporaryChat = false }) {
  return postForm({
    url: `${apiBase}/api/chat/message`,
    token,
    fields: [
      ['content', content],
      ['sessionId', sessionId],
      ...(temporaryChat ? [['temporaryChat', 'true']] : []),
    ],
  });
}

function renderTranscript(run) {
  const lines = [
    `# ${run.title}`,
    '',
    `- Generated at: ${run.generatedAt}`,
    `- API base: ${run.apiBase}`,
    `- Dry run: ${run.dryRun ? 'yes' : 'no'}`,
    '',
  ];

  run.cases.forEach((reviewCase) => {
    lines.push(`## ${reviewCase.title}`);
    lines.push('');
    lines.push(`- Case ID: ${reviewCase.id}`);
    lines.push(`- Mode: ${reviewCase.mode}`);
    lines.push(`- Temporary chat: ${reviewCase.temporaryChat ? 'yes' : 'no'}`);
    if (reviewCase.tags.length) lines.push(`- Tags: ${reviewCase.tags.join(', ')}`);
    if (reviewCase.focus.length) lines.push(`- Review focus: ${reviewCase.focus.join(' | ')}`);
    if (reviewCase.error) lines.push(`- Error: ${reviewCase.error}`);
    lines.push('');

    reviewCase.turns.forEach((turn) => {
      lines.push(`### Turn ${turn.index}`);
      lines.push('');
      lines.push('**User**');
      lines.push('');
      lines.push(turn.userInput);
      lines.push('');
      lines.push('**William**');
      lines.push('');
      lines.push(turn.assistantReply || '_No reply captured_');
      lines.push('');
      if (turn.expectedQualities.length) {
        lines.push(`- Expected qualities: ${turn.expectedQualities.join(' | ')}`);
      }
      if (turn.reviewerNotes) {
        lines.push(`- Reviewer hint: ${turn.reviewerNotes}`);
      }
      if (Array.isArray(turn.scheduleCandidates) && turn.scheduleCandidates.length > 0) {
        lines.push(`- Schedule candidates: ${turn.scheduleCandidates.length}`);
      }
      lines.push('');
    });
  });

  return `${lines.join('\n')}\n`;
}

function renderScorecard(run) {
  const lines = [
    `# ${run.title} Scorecard`,
    '',
    '## Scoring guide',
    '',
    '- `Relevance`: Did William answer the actual user need instead of a nearby topic?',
    '- `Attunement`: Did the tone match the user state without sounding cold or over-the-top?',
    '- `Restraint`: Did William avoid over-reading memory, over-analyzing, or jumping ahead?',
    '- `Memory Usefulness`: If memory was used, did it help? If not applicable, mark `NA`.',
    '- `Actionability`: If advice was needed, was it concrete and usable? If not applicable, mark `NA`.',
    '- `Non-Mechanical`: Did the reply feel natural rather than templated or instructional?',
    '- `Overall`: Your final judgment for this turn.',
    '',
    'Score each item from `1` to `5`:',
    '',
    '- `1`: clearly poor / harmful / off-target',
    '- `2`: weak and noticeably flawed',
    '- `3`: acceptable but unconvincing',
    '- `4`: strong',
    '- `5`: very strong',
    '',
  ];

  run.cases.forEach((reviewCase) => {
    lines.push(`## ${reviewCase.title}`);
    lines.push('');
    if (reviewCase.focus.length) {
      lines.push(`- Review focus: ${reviewCase.focus.join(' | ')}`);
      lines.push('');
    }
    lines.push('| Turn | User Input | Relevance | Attunement | Restraint | Memory Usefulness | Actionability | Non-Mechanical | Overall | Notes |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    reviewCase.turns.forEach((turn) => {
      lines.push(`| ${turn.index} | ${escapeTable(turn.userInput)} |  |  |  |  |  |  |  | ${escapeTable(turn.reviewerNotes || '')} |`);
    });
    lines.push('');
  });

  return `${lines.join('\n')}\n`;
}

function renderScorecardCsv(run) {
  const rows = [[
    'case_id',
    'case_title',
    'turn',
    'user_input',
    'assistant_reply',
    'review_focus',
    'relevance',
    'attunement',
    'restraint',
    'memory_usefulness',
    'actionability',
    'non_mechanical',
    'overall',
    'notes',
  ]];

  run.cases.forEach((reviewCase) => {
    reviewCase.turns.forEach((turn) => {
      rows.push([
        reviewCase.id,
        reviewCase.title,
        String(turn.index),
        turn.userInput,
        turn.assistantReply || '',
        reviewCase.focus.join(' | '),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        turn.reviewerNotes || '',
      ]);
    });
  });

  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

function writeBundle(run, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const resultsPath = path.join(outputDir, 'review-results.json');
  const transcriptPath = path.join(outputDir, 'review-transcript.md');
  const scorecardPath = path.join(outputDir, 'review-scorecard.md');
  const scorecardCsvPath = path.join(outputDir, 'review-scorecard.csv');
  fs.writeFileSync(resultsPath, `${JSON.stringify(run, null, 2)}\n`);
  fs.writeFileSync(transcriptPath, renderTranscript(run));
  fs.writeFileSync(scorecardPath, renderScorecard(run));
  fs.writeFileSync(scorecardCsvPath, renderScorecardCsv(run));
}

function escapeTable(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function csvEscape(value) {
  const text = String(value || '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function postJson({ url, token = '', body = {} }) {
  const args = [
    '--noproxy', '*',
    '-sS',
    '-w', '\n%{http_code}',
    '-X', 'POST',
    url,
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify(body),
  ];
  if (token) {
    args.push('-H', `Authorization: Bearer ${token}`);
  }
  return runCurlJson(args, url);
}

function postForm({ url, token = '', fields = [] }) {
  const args = [
    '--noproxy', '*',
    '-sS',
    '-w', '\n%{http_code}',
    '-X', 'POST',
    url,
  ];
  if (token) {
    args.push('-H', `Authorization: Bearer ${token}`);
  }
  fields.forEach(([key, value]) => {
    args.push('-F', `${key}=${value}`);
  });
  return runCurlJson(args, url);
}

function runCurlJson(args, url) {
  const result = spawnSync('curl', args, {
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`curl failed for ${url}: ${result.stderr || result.stdout}`.trim());
  }

  const output = result.stdout || '';
  const lastNewline = output.lastIndexOf('\n');
  const body = lastNewline >= 0 ? output.slice(0, lastNewline) : output;
  const statusText = lastNewline >= 0 ? output.slice(lastNewline + 1).trim() : '';
  const status = Number(statusText);
  if (!Number.isFinite(status)) {
    throw new Error(`Invalid HTTP status from curl for ${url}`);
  }
  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status} from ${url}: ${body}`);
  }
  return body ? JSON.parse(body) : {};
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[RealReview] Failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  renderTranscript,
  renderScorecard,
  renderScorecardCsv,
  writeBundle,
};
