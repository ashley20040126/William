const axios = require('axios');
const cheerio = require('cheerio');
const dns = require('dns').promises;
const net = require('net');
const { getProxyForUrl } = require('proxy-from-env');

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const URL_IMPORT_TIMEOUT_MS = parseInt(process.env.URL_IMPORT_TIMEOUT_MS || '12000', 10);
const URL_IMPORT_MAX_BYTES = parseInt(process.env.URL_IMPORT_MAX_BYTES || String(2 * 1024 * 1024), 10);
const URL_IMPORT_TEXT_LIMIT = parseInt(process.env.URL_IMPORT_TEXT_LIMIT || '12000', 10);
const URL_IMPORT_EXCERPT_LIMIT = parseInt(process.env.URL_IMPORT_EXCERPT_LIMIT || '1000', 10);

async function importFromUrl(rawUrl) {
  const normalizedUrl = normalizeRemoteUrl(rawUrl);
  await assertSafeRemoteUrl(normalizedUrl);
  const providerHint = detectProviderHint(normalizedUrl);

  const response = await axios.get(normalizedUrl, {
    timeout: URL_IMPORT_TIMEOUT_MS,
    responseType: 'text',
    maxContentLength: URL_IMPORT_MAX_BYTES,
    maxBodyLength: URL_IMPORT_MAX_BYTES,
    maxRedirects: 4,
    headers: {
      'User-Agent': 'WilliamBot/1.0 (+https://william.local)',
      Accept: 'text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8',
    },
    transformResponse: [(data) => data],
    ...buildProxyConfig(normalizedUrl),
  });

  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  if (!/(text\/html|text\/plain|application\/xhtml\+xml)/.test(contentType)) {
    throw new Error('只支持导入公开的 HTML 或纯文本页面');
  }

  const extracted = extractReadableContent(response.data, normalizedUrl, contentType, providerHint);
  const summarized = await summarizeImportedPage({
    url: normalizedUrl,
    title: extracted.title,
    description: extracted.description,
    text: extracted.text,
    providerHint,
  });

  return {
    url: normalizedUrl,
    title: extracted.title || summarized.title || new URL(normalizedUrl).hostname,
    summary: summarized.summary,
    excerpt: summarized.excerpt,
    memoryFacts: summarized.memoryFacts,
    extractedText: extracted.text,
    meta: {
      sourceType: 'url',
      sourceUrl: normalizedUrl,
      title: extracted.title,
      hostname: new URL(normalizedUrl).hostname,
      contentType,
      providerHint,
      turnCount: extracted.turnCount || 0,
      extractionMode: extracted.extractionMode || 'generic',
    },
  };
}

function normalizeRemoteUrl(rawUrl) {
  const normalized = String(rawUrl || '').trim();
  if (!normalized) {
    throw new Error('AI Chat URL 不能为空');
  }

  const parsed = new URL(normalized);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('只支持 http/https 链接');
  }

  parsed.hash = '';
  return parsed.toString();
}

async function assertSafeRemoteUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  const hostname = parsed.hostname.toLowerCase();

  if (isBlockedHostname(hostname)) {
    throw new Error('不允许导入本地或内网地址');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error('不允许导入本地或内网地址');
    }
    return;
  }

  const lookups = await dns.lookup(hostname, { all: true }).catch(() => []);
  if (lookups.some((entry) => isPrivateIp(entry.address))) {
    throw new Error('不允许导入本地或内网地址');
  }
}

function isBlockedHostname(hostname) {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  );
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    return (
      address.startsWith('10.') ||
      address.startsWith('127.') ||
      address.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(address) ||
      address === '0.0.0.0'
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80')
    );
  }

  return false;
}

function extractReadableContent(rawHtml, pageUrl, contentType, providerHint = 'generic') {
  if (/text\/plain/.test(contentType)) {
    const text = cleanText(rawHtml, URL_IMPORT_TEXT_LIMIT);
    return {
      title: firstNonEmptyLine(text) || new URL(pageUrl).hostname,
      description: '',
      text,
      turnCount: 0,
      extractionMode: 'plain_text',
    };
  }

  const $ = cheerio.load(rawHtml);
  $('script, style, noscript, svg, canvas, iframe, header nav, footer nav').remove();

  const title = cleanSnippet(
    $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').first().text(),
    180
  );
  const description = cleanSnippet(
    $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content'),
    220
  );

  const providerExtracted = extractProviderConversation($, rawHtml, providerHint);
  if (providerExtracted.text) {
    return {
      title: providerExtracted.title || title || new URL(pageUrl).hostname,
      description: providerExtracted.description || description,
      text: cleanText(providerExtracted.text, URL_IMPORT_TEXT_LIMIT),
      turnCount: providerExtracted.turnCount || 0,
      extractionMode: providerExtracted.extractionMode || providerHint,
    };
  }

  const textCandidates = [
    collectNodeText($, '[data-message-author-role]'),
    collectNodeText($, '[data-testid*="conversation"]'),
    collectNodeText($, '[class*="conversation"]'),
    collectNodeText($, '[class*="message"]'),
    collectNodeText($, 'article'),
    collectNodeText($, 'main'),
    collectNodeText($, '[role="main"]'),
    collectNodeText($, '.prose'),
    collectNodeText($, 'body'),
  ].filter(Boolean);

  const text = cleanText(textCandidates[0] || [title, description].filter(Boolean).join('\n'), URL_IMPORT_TEXT_LIMIT);

  return {
    title: title || new URL(pageUrl).hostname,
    description,
    text,
    turnCount: 0,
    extractionMode: 'generic_dom',
  };
}

function extractProviderConversation($, rawHtml, providerHint) {
  if (providerHint === 'openai') {
    return extractChatGptConversation($, rawHtml);
  }
  if (providerHint === 'claude') {
    return extractClaudeConversation($, rawHtml);
  }
  if (providerHint === 'gemini') {
    return extractGeminiConversation($, rawHtml);
  }
  return { text: '' };
}

function extractChatGptConversation($, rawHtml) {
  const domTurns = extractTurnsFromDom($, [
    { selector: '[data-message-author-role]', roleAttr: 'data-message-author-role' },
    { selector: 'main article [data-message-author-role]', roleAttr: 'data-message-author-role' },
  ]);
  if (domTurns.length > 0) {
    return {
      text: formatTurns(domTurns),
      turnCount: domTurns.length,
      extractionMode: 'openai_dom',
    };
  }

  const scriptTurns = extractTurnsFromScripts(rawHtml, {
    roleCandidates: ['user', 'assistant', 'system', 'tool'],
    textKeys: ['text', 'content', 'value', 'parts'],
  });
  return {
    text: formatTurns(scriptTurns),
    turnCount: scriptTurns.length,
    extractionMode: scriptTurns.length > 0 ? 'openai_script' : '',
  };
}

function extractClaudeConversation($, rawHtml) {
  const domTurns = extractTurnsFromDom($, [
    { selector: '[data-testid*="message"]', roleTextStrategy: 'claude' },
    { selector: 'main article', roleTextStrategy: 'claude' },
    { selector: '[class*="message"]', roleTextStrategy: 'claude' },
  ]);
  if (domTurns.length > 0) {
    return {
      text: formatTurns(domTurns),
      turnCount: domTurns.length,
      extractionMode: 'claude_dom',
    };
  }

  const scriptTurns = extractTurnsFromScripts(rawHtml, {
    roleCandidates: ['human', 'assistant', 'claude', 'user'],
    textKeys: ['text', 'content', 'completion', 'message'],
  });
  return {
    text: formatTurns(scriptTurns),
    turnCount: scriptTurns.length,
    extractionMode: scriptTurns.length > 0 ? 'claude_script' : '',
  };
}

function extractGeminiConversation($, rawHtml) {
  const domTurns = extractTurnsFromDom($, [
    { selector: 'main article', roleTextStrategy: 'gemini' },
    { selector: '[data-test-id*="message"]', roleTextStrategy: 'gemini' },
    { selector: '[class*="conversation-turn"]', roleTextStrategy: 'gemini' },
  ]);
  if (domTurns.length > 0) {
    return {
      text: formatTurns(domTurns),
      turnCount: domTurns.length,
      extractionMode: 'gemini_dom',
    };
  }

  const scriptTurns = extractTurnsFromScripts(rawHtml, {
    roleCandidates: ['user', 'model', 'assistant', 'gemini'],
    textKeys: ['text', 'content', 'parts', 'response'],
  });
  return {
    text: formatTurns(scriptTurns),
    turnCount: scriptTurns.length,
    extractionMode: scriptTurns.length > 0 ? 'gemini_script' : '',
  };
}

function extractTurnsFromDom($, configs) {
  for (const config of configs) {
    const turns = [];
    $(config.selector).each((_, node) => {
      const role = resolveRoleFromNode($, node, config);
      const text = cleanText($(node).text(), 1600);
      if (!role || !text || text.length < 12) return;
      turns.push({ role, text });
    });
    const normalized = normalizeTurns(turns);
    if (normalized.length >= 2) return normalized;
  }
  return [];
}

function resolveRoleFromNode($, node, config) {
  if (config.roleAttr) {
    const attr = $(node).attr(config.roleAttr);
    const mapped = normalizeProviderRole(attr);
    if (mapped) return mapped;
  }

  const nodeText = cleanSnippet($(node).text(), 120).toLowerCase();
  if (config.roleTextStrategy === 'claude') {
    if (/^human|^user|you said/.test(nodeText)) return 'user';
    if (/^claude|^assistant/.test(nodeText)) return 'assistant';
  }
  if (config.roleTextStrategy === 'gemini') {
    if (/^you|^user/.test(nodeText)) return 'user';
    if (/^gemini|^model|^assistant/.test(nodeText)) return 'assistant';
  }
  return '';
}

function extractTurnsFromScripts(rawHtml, options = {}) {
  const roleCandidates = options.roleCandidates || [];
  const textKeys = options.textKeys || [];
  const turns = [];
  const $ = cheerio.load(rawHtml);

  $('script').each((_, script) => {
    const scriptText = ($(script).html() || '').trim();
    if (!scriptText || scriptText.length > 400000) return;
    if (!/[{\[]/.test(scriptText)) return;
    const parsedCandidates = parseScriptJsonCandidates(scriptText);
    parsedCandidates.forEach((candidate) => {
      walkJson(candidate, (value) => {
        const extracted = tryBuildTurn(value, roleCandidates, textKeys);
        if (extracted) {
          turns.push(extracted);
        }
      });
    });
  });

  return normalizeTurns(turns);
}

function parseScriptJsonCandidates(scriptText) {
  const candidates = [];
  const direct = safeJsonParse(scriptText, null);
  if (direct) candidates.push(direct);

  const wrappers = [
    /=\s*({[\s\S]*})\s*;?\s*$/,
    /=\s*(\[[\s\S]*\])\s*;?\s*$/,
    /JSON\.parse\((["'`])([\s\S]*?)\1\)/,
  ];

  wrappers.forEach((pattern) => {
    const match = scriptText.match(pattern);
    if (!match) return;
    const candidate = pattern.source.includes('JSON\\.parse')
      ? safeJsonParse(unescapeJsonString(match[2]), null)
      : safeJsonParse(match[1], null);
    if (candidate) candidates.push(candidate);
  });

  return candidates;
}

function tryBuildTurn(value, roleCandidates, textKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const roleRaw =
    value.role ||
    value.author ||
    value.author_role ||
    value.message_role ||
    value.sender ||
    value.speaker;
  const role = normalizeProviderRole(typeof roleRaw === 'object' ? roleRaw.role || roleRaw.name : roleRaw, roleCandidates);
  if (!role) return null;

  const text = extractTextFromObject(value, textKeys);
  if (!text || text.length < 12) return null;

  return { role, text };
}

function extractTextFromObject(value, textKeys) {
  const visited = new Set();
  const queue = [value];
  const chunks = [];

  while (queue.length > 0 && chunks.join('\n').length < 3000) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      current.forEach((item) => queue.push(item));
      continue;
    }

    for (const [key, nested] of Object.entries(current)) {
      if (textKeys.includes(key) && typeof nested === 'string') {
        const cleaned = cleanText(nested, 1200);
        if (cleaned) chunks.push(cleaned);
      } else if (textKeys.includes(key) && Array.isArray(nested)) {
        const arrText = nested
          .flatMap((item) => {
            if (typeof item === 'string') return [item];
            if (item && typeof item === 'object') return [item.text, item.content, item.value].filter(Boolean);
            return [];
          })
          .join('\n');
        const cleaned = cleanText(arrText, 1200);
        if (cleaned) chunks.push(cleaned);
      } else if (nested && typeof nested === 'object') {
        queue.push(nested);
      }
    }
  }

  return cleanText(uniqueList(chunks).join('\n'), 1600);
}

function normalizeTurns(turns) {
  const normalized = [];
  turns.forEach((turn) => {
    const role = normalizeProviderRole(turn.role);
    const text = cleanText(turn.text, 1600);
    if (!role || !text) return;
    const last = normalized[normalized.length - 1];
    if (last && last.role === role) {
      last.text = cleanText(`${last.text}\n${text}`, 1800);
      return;
    }
    normalized.push({ role, text });
  });
  return normalized.slice(0, 24);
}

function formatTurns(turns) {
  if (!turns || turns.length === 0) return '';
  return turns
    .map((turn, index) => `${index + 1}. ${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`)
    .join('\n\n');
}

function collectNodeText($, selector) {
  const chunks = [];
  $(selector).each((_, node) => {
    const text = cleanText($(node).text(), 1200);
    if (text) {
      chunks.push(text);
    }
  });
  return cleanText(uniqueList(chunks).join('\n\n'), URL_IMPORT_TEXT_LIMIT);
}

async function summarizeImportedPage({ url, title, description, text, providerHint = 'generic' }) {
  const fallback = buildFallbackSummary({ url, title, description, text });
  if (!OPENAI_API_KEY || !text) {
    return fallback;
  }

  const endpoint = `${OPENAI_BASE_URL}/chat/completions`;
  try {
    const response = await axios.post(
      endpoint,
      {
        model: OPENAI_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是 William 的公开链接导入器。只输出 JSON，不要输出额外文字。',
          },
          {
            role: 'user',
            content: [
              '请把这个公开链接页面整理成 William 可读的上下文，返回 JSON：',
              '{',
              '  "title": "页面标题",',
              '  "summary": "两三句中文摘要，适合直接注入聊天",',
              '  "excerpt": "最关键的一段正文摘录，便于后续追问",',
              '  "memory_facts": ["可沉淀到记忆系统的稳定事实，最多3条"]',
              '}',
              `Provider: ${providerHint}`,
              `URL: ${url}`,
              title ? `标题: ${title}` : '',
              description ? `描述: ${description}` : '',
              '正文：',
              cleanSnippet(text, URL_IMPORT_TEXT_LIMIT),
            ].filter(Boolean).join('\n\n'),
          },
        ],
        temperature: 0.2,
        max_tokens: 650,
      },
      {
        timeout: parseInt(process.env.OPENAI_TIMEOUT_MS || '30000', 10),
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        ...buildProxyConfig(endpoint),
      }
    );

    const parsed = safeJsonParse(response.data?.choices?.[0]?.message?.content || '{}', {});
    return {
      title: cleanSnippet(parsed.title || title || new URL(url).hostname, 180),
      summary: cleanSnippet(parsed.summary || fallback.summary, 260),
      excerpt: cleanSnippet(parsed.excerpt || fallback.excerpt, URL_IMPORT_EXCERPT_LIMIT),
      memoryFacts: normalizeStringArray(parsed.memory_facts).slice(0, 3),
    };
  } catch {
    return fallback;
  }
}

function buildFallbackSummary({ url, title, description, text }) {
  const excerpt = cleanSnippet(text, URL_IMPORT_EXCERPT_LIMIT);
  const memoryFacts = [];
  if (title) {
    memoryFacts.push(`用户导入了一个公开链接，主题与“${title}”有关`);
  }
  if (/职业|求职|面试|转岗|产品经理/.test(text)) {
    memoryFacts.push('导入链接涉及职业发展、求职或转型话题');
  }
  if (/家庭|妈妈|爸爸|伴侣|关系|沟通/.test(text)) {
    memoryFacts.push('导入链接涉及关系或沟通议题');
  }

  return {
    title: cleanSnippet(title || new URL(url).hostname, 180),
    summary: cleanSnippet(
      [title ? `页面标题：${title}` : '', description || excerpt || `用户导入了公开链接：${url}`]
        .filter(Boolean)
        .join('；'),
      260
    ),
    excerpt,
    memoryFacts: uniqueList(memoryFacts).slice(0, 3),
  };
}

function detectProviderHint(rawUrl) {
  const parsed = new URL(rawUrl);
  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  if (hostname.includes('claude') || hostname.includes('anthropic')) return 'claude';
  if (hostname.includes('gemini') || hostname.includes('google') || pathname.includes('/gemini/share/')) return 'gemini';
  if (
    hostname.includes('chatgpt') ||
    hostname.includes('openai') ||
    ((hostname.includes('chat.com') || hostname.includes('chatgpt.com')) && pathname.includes('/share/'))
  ) {
    return 'openai';
  }
  return 'generic';
}

function normalizeProviderRole(role, allowedRoles = []) {
  const normalized = String(role || '').trim().toLowerCase();
  if (!normalized) return '';
  if (allowedRoles.length > 0 && !allowedRoles.some((candidate) => normalized.includes(candidate))) {
    if (!/(user|assistant|human|claude|gemini|model)/.test(normalized)) return '';
  }
  if (/(user|human)/.test(normalized)) return 'user';
  if (/(assistant|claude|gemini|model)/.test(normalized)) return 'assistant';
  return '';
}

function walkJson(value, visitor, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  visitor(value);

  if (Array.isArray(value)) {
    value.forEach((item) => walkJson(item, visitor, seen));
    return;
  }

  Object.values(value).forEach((nested) => walkJson(nested, visitor, seen));
}

function unescapeJsonString(text) {
  try {
    return JSON.parse(`"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  } catch {
    return text;
  }
}

function buildProxyConfig(targetUrl) {
  const proxyUrl = getProxyForUrl(targetUrl);
  if (!proxyUrl) return { proxy: false };

  const parsed = new URL(proxyUrl);
  return {
    proxy: {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port: Number(parsed.port),
    },
  };
}

function firstNonEmptyLine(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean) || '';
}

function cleanText(text, limit) {
  return cleanSnippet(
    String(text || '')
      .replace(/\r/g, '\n')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    limit
  );
}

function cleanSnippet(text, limit) {
  const normalized = String(text || '').trim();
  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeStringArray(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => cleanSnippet(String(item || ''), 120))
    .filter(Boolean);
}

function uniqueList(items) {
  return [...new Set((items || []).filter(Boolean))];
}

module.exports = {
  importFromUrl,
};
