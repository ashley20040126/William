const fs = require('fs');
const axios = require('axios');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const { getProxyForUrl } = require('proxy-from-env');
const db = require('../utils/db');
const { importFromUrl } = require('./urlImportService');

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ATTACHMENT_TEXT_LIMIT = parseInt(process.env.ATTACHMENT_TEXT_LIMIT || '8000', 10);
const ATTACHMENT_SUMMARY_LIMIT = parseInt(process.env.ATTACHMENT_SUMMARY_LIMIT || '220', 10);
const ATTACHMENT_EXCERPT_LIMIT = parseInt(process.env.ATTACHMENT_EXCERPT_LIMIT || '800', 10);
const ATTACHMENT_CONTEXT_LIMIT = parseInt(process.env.ATTACHMENT_CONTEXT_LIMIT || '4', 10);
const execFileAsync = promisify(execFile);

async function ensureAttachmentSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_attachments (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      message_id BIGINT UNSIGNED NOT NULL,
      session_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      kind ENUM('image','document','audio','other') NOT NULL DEFAULT 'other',
      status ENUM('uploaded','processing','ready','failed') NOT NULL DEFAULT 'uploaded',
      original_name VARCHAR(255) NOT NULL,
      storage_path VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
      extracted_text MEDIUMTEXT,
      summary TEXT,
      ocr_text MEDIUMTEXT,
      memory_facts JSON,
      meta_json JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_message (message_id),
      INDEX idx_session_time (session_id, created_at),
      INDEX idx_user_status (user_id, status, updated_at),
      FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

async function processUploadedFiles({ userId, sessionId, messageId, files = [] }) {
  const normalizedFiles = Array.isArray(files) ? files : [];
  if (normalizedFiles.length === 0) {
    return {
      attachments: [],
      contextText: '',
      memoryText: '',
      analysisText: '',
      displayText: '',
    };
  }

  const processedAttachments = [];

  for (const file of normalizedFiles) {
    const kind = resolveAttachmentKind(file.mimetype);
    const [insertResult] = await db.execute(
      `INSERT INTO chat_attachments (
         message_id, session_id, user_id, kind, status, original_name, storage_path, mime_type, size_bytes
       ) VALUES (?, ?, ?, ?, 'processing', ?, ?, ?, ?)`,
      [
        messageId,
        sessionId,
        userId,
        kind,
        file.originalname,
        `/uploads/${file.filename}`,
        file.mimetype,
        file.size || 0,
      ]
    );

    try {
      const extracted = await extractAttachmentInsight(file, kind);
      const attachment = {
        id: insertResult.insertId,
        kind,
        status: 'ready',
        name: file.originalname,
        path: `/uploads/${file.filename}`,
        type: file.mimetype,
        size: file.size,
        summary: extracted.summary,
        excerpt: extracted.excerpt,
        ocrText: extracted.ocrText,
        memoryFacts: extracted.memoryFacts,
        meta: extracted.meta,
      };

      await db.execute(
        `UPDATE chat_attachments
         SET status = 'ready',
             extracted_text = ?,
             summary = ?,
             ocr_text = ?,
             memory_facts = ?,
             meta_json = ?
         WHERE id = ?`,
        [
          extracted.extractedText || null,
          extracted.summary || null,
          extracted.ocrText || null,
          JSON.stringify(extracted.memoryFacts || []),
          JSON.stringify(extracted.meta || {}),
          insertResult.insertId,
        ]
      );

      processedAttachments.push(attachment);
    } catch (error) {
      const fallbackSummary = buildFallbackSummary(file.originalname, kind);
      await db.execute(
        `UPDATE chat_attachments
         SET status = 'failed',
             summary = ?,
             meta_json = ?
         WHERE id = ?`,
        [
          fallbackSummary,
          JSON.stringify({ error: error.message }),
          insertResult.insertId,
        ]
      );

      processedAttachments.push({
        id: insertResult.insertId,
        kind,
        status: 'failed',
        name: file.originalname,
        path: `/uploads/${file.filename}`,
        type: file.mimetype,
        size: file.size,
        summary: fallbackSummary,
        excerpt: '',
        ocrText: '',
        memoryFacts: [],
        meta: { error: error.message },
      });
    }
  }

  return {
    attachments: processedAttachments,
    contextText: formatAttachmentContext(processedAttachments, {
      title: '【当前消息附件】',
      includeExcerpt: true,
    }),
    memoryText: buildAttachmentMemoryText(processedAttachments),
    analysisText: buildAttachmentAnalysisText(processedAttachments),
    displayText: buildAttachmentDisplayText(processedAttachments),
  };
}

async function processImportedLink({ userId, sessionId, messageId, url }) {
  const [insertResult] = await db.execute(
    `INSERT INTO chat_attachments (
       message_id, session_id, user_id, kind, status, original_name, storage_path, mime_type, size_bytes
     ) VALUES (?, ?, ?, 'document', 'processing', ?, ?, 'text/html', 0)`,
    [
      messageId,
      sessionId,
      userId,
      'AI Chat Link',
      url,
    ]
  );

  try {
    const imported = await importFromUrl(url);
    const attachment = {
      id: insertResult.insertId,
      kind: 'document',
      status: 'ready',
      name: imported.title || 'AI Chat Link',
      path: imported.url,
      type: 'text/html',
      size: 0,
      summary: imported.summary,
      excerpt: imported.excerpt,
      ocrText: '',
      memoryFacts: imported.memoryFacts,
      meta: imported.meta,
    };

    await db.execute(
      `UPDATE chat_attachments
       SET status = 'ready',
           original_name = ?,
           storage_path = ?,
           extracted_text = ?,
           summary = ?,
           memory_facts = ?,
           meta_json = ?
       WHERE id = ?`,
      [
        attachment.name,
        imported.url,
        imported.extractedText || null,
        attachment.summary || null,
        JSON.stringify(attachment.memoryFacts || []),
        JSON.stringify(attachment.meta || {}),
        insertResult.insertId,
      ]
    );

    return {
      attachments: [attachment],
      contextText: formatAttachmentContext([attachment], {
        title: '【当前消息附件】',
        includeExcerpt: true,
      }),
      memoryText: buildAttachmentMemoryText([attachment]),
      analysisText: buildAttachmentAnalysisText([attachment]),
      displayText: 'Shared AI Chat link',
    };
  } catch (error) {
    const fallbackSummary = `导入链接失败：${error.message}`;
    await db.execute(
      `UPDATE chat_attachments
       SET status = 'failed',
           summary = ?,
           meta_json = ?
       WHERE id = ?`,
      [
        fallbackSummary,
        JSON.stringify({ sourceType: 'url', sourceUrl: url, error: error.message }),
        insertResult.insertId,
      ]
    );

    throw error;
  }
}

async function buildAttachmentConversationContext({ sessionId, beforeMessageId = null, limit = ATTACHMENT_CONTEXT_LIMIT }) {
  const queryLimit = clampPositiveInt(limit, ATTACHMENT_CONTEXT_LIMIT);
  const [rows] = await db.execute(
    `SELECT id, message_id, kind, status, original_name, storage_path, mime_type, size_bytes,
            summary, extracted_text, ocr_text, memory_facts, created_at
     FROM chat_attachments
     WHERE session_id = ?
       AND status = 'ready'
       ${beforeMessageId ? 'AND message_id < ?' : ''}
     ORDER BY id DESC
     LIMIT ${queryLimit}`,
    beforeMessageId ? [sessionId, beforeMessageId] : [sessionId]
  );

  if (rows.length === 0) return '';

  return formatAttachmentContext(rows.reverse().map(mapAttachmentRow), {
    title: '【最近附件上下文】',
    includeExcerpt: true,
  });
}

function resolveAttachmentKind(mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (
    mimeType === 'application/pdf' ||
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType.startsWith('text/')
  ) {
    return 'document';
  }
  return 'other';
}

async function extractAttachmentInsight(file, kind) {
  if (kind === 'image') {
    return extractImageInsight(file);
  }
  if (kind === 'document') {
    return extractDocumentInsight(file);
  }
  return {
    summary: buildFallbackSummary(file.originalname, kind),
    excerpt: '',
    extractedText: '',
    ocrText: '',
    memoryFacts: [],
    meta: { parser: 'fallback' },
  };
}

async function extractDocumentInsight(file) {
  const extractedText = cleanText(await readDocumentText(file), ATTACHMENT_TEXT_LIMIT);
  const summary = buildDocumentSummary(extractedText, file.originalname);
  const excerpt = cleanSnippet(extractedText, ATTACHMENT_EXCERPT_LIMIT);
  const memoryFacts = deriveDocumentMemoryFacts(extractedText, file.originalname);

  return {
    summary,
    excerpt,
    extractedText,
    ocrText: '',
    memoryFacts,
    meta: {
      parser: getDocumentParserName(file.mimetype),
      textLength: extractedText.length,
    },
  };
}

async function extractImageInsight(file) {
  if (!OPENAI_API_KEY) {
    return {
      summary: buildFallbackSummary(file.originalname, 'image'),
      excerpt: '',
      extractedText: '',
      ocrText: '',
      memoryFacts: [],
      meta: { parser: 'fallback_no_openai' },
    };
  }

  const base64Image = fs.readFileSync(file.path, { encoding: 'base64' });
  const endpoint = `${OPENAI_BASE_URL}/chat/completions`;
  const response = await axios.post(
    endpoint,
    {
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: '你是 William 的附件解析器。只输出 JSON，不要输出额外文字。',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                '请分析这张用户上传的图片，并返回 JSON：',
                '{',
                '  "summary": "一句话概括图片核心内容，适合聊天使用",',
                '  "ocr_text": "图片中可见文字，没有则为空字符串",',
                '  "memory_facts": ["可稳定写入记忆的事实，最多3条，没有则空数组"]',
                '}',
                '要求：summary 中文、自然、简洁；不要臆测用户未提供的事实；若是聊天截图，优先提取可见文字和讨论主题。',
              ].join('\n'),
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${file.mimetype};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
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

  const rawContent = response.data?.choices?.[0]?.message?.content || '{}';
  const parsed = safeJsonParse(rawContent, {});
  const summary = cleanSnippet(parsed.summary || `用户上传了一张图片：${file.originalname}`, ATTACHMENT_SUMMARY_LIMIT);
  const ocrText = cleanText(parsed.ocr_text || '', ATTACHMENT_EXCERPT_LIMIT);
  const memoryFacts = Array.isArray(parsed.memory_facts)
    ? parsed.memory_facts.map((item) => cleanSnippet(String(item || ''), 120)).filter(Boolean).slice(0, 3)
    : [];

  return {
    summary,
    excerpt: ocrText,
    extractedText: ocrText,
    ocrText,
    memoryFacts,
    meta: {
      parser: 'openai_vision',
    },
  };
}

async function readDocumentText(file) {
  if (file.mimetype === 'application/pdf') {
    return readPdfText(file.path);
  }

  if (file.mimetype === 'application/msword') {
    return readLegacyWordText(file.path);
  }

  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const parsed = await mammoth.extractRawText({ path: file.path });
    return parsed.value || '';
  }

  if (file.mimetype.startsWith('text/')) {
    return fs.readFileSync(file.path, 'utf8');
  }

  return '';
}

function getDocumentParserName(mimeType) {
  if (mimeType === 'application/pdf') return 'pdf-parse-v2';
  if (mimeType === 'application/msword') return 'textutil';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'mammoth';
  if (mimeType.startsWith('text/')) return 'utf8';
  return 'unknown';
}

async function readPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function readLegacyWordText(filePath) {
  const { stdout } = await execFileAsync('/usr/bin/textutil', ['-convert', 'txt', '-stdout', filePath], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout || '';
}

function buildDocumentSummary(extractedText, originalName) {
  if (!extractedText) {
    return `用户上传了文件《${originalName}》，但未能提取到可读文本。`;
  }

  const lines = extractedText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);

  const summarySeed = lines.join('；') || cleanSnippet(extractedText, ATTACHMENT_SUMMARY_LIMIT);
  return cleanSnippet(`文件《${originalName}》的主要内容：${summarySeed}`, ATTACHMENT_SUMMARY_LIMIT);
}

function deriveDocumentMemoryFacts(extractedText, originalName) {
  if (!extractedText) return [];

  const facts = [];
  if (/简历|resume|求职|面试|作品集/i.test(extractedText)) {
    facts.push('用户上传的文件与求职或职业转型有关');
  }
  if (/妈妈|爸爸|父母|伴侣|老板|同事|朋友/.test(extractedText)) {
    facts.push('用户上传的文件提到了重要关系对象或沟通场景');
  }
  if (/焦虑|压力|失眠|难过|害怕|卡住/.test(extractedText)) {
    facts.push('用户上传的文件里包含持续困扰或情绪压力线索');
  }
  if (facts.length === 0) {
    facts.push(`用户上传了文件《${originalName}》并希望 William 结合内容理解`);
  }
  return facts.slice(0, 3);
}

function formatAttachmentContext(attachments, options = {}) {
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  if (normalizedAttachments.length === 0) return '';

  const lines = [];
  if (options.title) {
    lines.push(options.title);
  }

  normalizedAttachments.forEach((attachment) => {
    const label = attachment.kind === 'image' ? '图片' : attachment.kind === 'document' ? '文件' : '附件';
    const summary = cleanSnippet(
      attachment.summary || buildFallbackSummary(attachment.name || attachment.original_name, attachment.kind),
      ATTACHMENT_SUMMARY_LIMIT
    );
    lines.push(`- [${label}] ${attachment.name || attachment.original_name}：${summary}`);

    const facts = normalizeStringArray(attachment.memoryFacts || attachment.memory_facts);
    if (facts.length > 0) {
      lines.push(`  可用事实：${facts.join('；')}`);
    }

    const excerpt = options.includeExcerpt
      ? cleanSnippet(attachment.excerpt || attachment.ocrText || attachment.ocr_text || attachment.extracted_text || '', ATTACHMENT_EXCERPT_LIMIT)
      : '';
    if (excerpt) {
      lines.push(`  关键内容：${excerpt}`);
    }
  });

  return cleanSnippet(lines.join('\n'), 5000);
}

function buildAttachmentMemoryText(attachments) {
  const facts = [];
  attachments.forEach((attachment) => {
    normalizeStringArray(attachment.memoryFacts).forEach((fact) => facts.push(fact));
    if (!attachment.memoryFacts?.length && attachment.summary) {
      facts.push(`用户上传的${attachment.kind === 'image' ? '图片' : '文件'}内容：${attachment.summary}`);
    }
  });
  return cleanSnippet(uniqueList(facts).join('\n'), 1200);
}

function buildAttachmentAnalysisText(attachments) {
  const snippets = attachments
    .map((attachment) => {
      const prefix = attachment.kind === 'image' ? '图片内容' : '文件内容';
      const core = attachment.summary || attachment.excerpt || '';
      return core ? `${prefix}：${core}` : '';
    })
    .filter(Boolean);

  return cleanSnippet(snippets.join('\n'), 1200);
}

function buildAttachmentDisplayText(attachments) {
  if (!attachments.length) return '';
  if (attachments.length === 1) {
    const attachment = attachments[0];
    if (attachment.meta?.sourceType === 'url' || /^https?:\/\//.test(attachment.path || '')) {
      return 'Shared AI Chat link';
    }
    return attachment.kind === 'image' ? 'Shared a photo' : 'Shared a file';
  }
  return `Shared ${attachments.length} attachments`;
}

function mapAttachmentRow(row) {
  return {
    id: row.id,
    messageId: row.message_id,
    kind: row.kind,
    status: row.status,
    name: row.original_name,
    path: row.storage_path,
    type: row.mime_type,
    size: row.size_bytes,
    summary: row.summary,
    excerpt: cleanSnippet(row.extracted_text || row.ocr_text || '', ATTACHMENT_EXCERPT_LIMIT),
    ocrText: row.ocr_text || '',
    memoryFacts: safeJsonParse(row.memory_facts, []),
    createdAt: row.created_at,
  };
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

function buildFallbackSummary(originalName, kind) {
  if (kind === 'image') return `用户上传了一张图片：${originalName}`;
  if (kind === 'document') return `用户上传了文件《${originalName}》`;
  return `用户上传了附件：${originalName}`;
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
  return [...new Set(items.filter(Boolean))];
}

function clampPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  ensureAttachmentSchema,
  processUploadedFiles,
  processImportedLink,
  buildAttachmentConversationContext,
  resolveAttachmentKind,
  extractAttachmentInsight,
  mapAttachmentRow,
};
