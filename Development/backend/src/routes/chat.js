const { Router } = require('express');
const db = require('../utils/db');
const { auth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { processChatTurn } = require('../services/chatService');
const { ensureChatSchema } = require('../services/chatSchemaService');
const { listCandidatesForMessages } = require('../services/scheduleCandidateService');
const { AMBIENT_HIDDEN_USER_PREFIX } = require('../services/ambientListeningService');

const router = Router();

function safeParse(val, fallback) {
  if (!val) return fallback;
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

async function hydratePracticeSuggestions({ userId, rows }) {
  const messageMap = new Map();
  const dateSet = new Set();

  rows.forEach((row) => {
    const suggestions = safeParse(row.practice_suggestions_json, []);
    if (!Array.isArray(suggestions) || suggestions.length === 0) return;
    messageMap.set(Number(row.id), suggestions);
    suggestions.forEach((item) => {
      const date = typeof item?.suggestionDate === 'string' ? item.suggestionDate.trim() : '';
      if (date) dateSet.add(date);
    });
  });

  if (dateSet.size === 0) return messageMap;

  const placeholders = [...dateSet].map(() => '?').join(', ');
  const [rowsByDate] = await db.query(
    `SELECT id, title, suggestion_date, status, completed_at
     FROM ai_practice_suggestions
     WHERE user_id = ? AND suggestion_date IN (${placeholders})`,
    [userId, ...dateSet]
  );

  const savedMap = new Map();
  rowsByDate.forEach((row) => {
    const key = `${String(row.suggestion_date).slice(0, 10)}::${String(row.title || '').trim()}`;
    savedMap.set(key, row);
  });

  for (const [messageId, suggestions] of messageMap.entries()) {
    messageMap.set(messageId, suggestions.map((item) => {
      const key = `${String(item?.suggestionDate || '').trim()}::${String(item?.title || '').trim()}`;
      const saved = savedMap.get(key);
      if (!saved) return item;
      return {
        ...item,
        id: `ai:${saved.id}`,
        rawId: Number(saved.id),
        saved: true,
        status: saved.status === 'completed' ? 'completed' : 'pending',
        completedAt: saved.completed_at || null,
      };
    }));
  }

  return messageMap;
}

// GET /api/chat/history
router.get('/history', auth, async (req, res) => {
  try {
    await ensureChatSchema();
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
    const sessionKey = typeof req.query.sessionId === 'string' && req.query.sessionId.trim()
      ? req.query.sessionId.trim()
      : null;
    
    // 1. Get user's last_cleared_at to filter history (Soft Clear)
    const [[user]] = await db.query('SELECT chat_last_cleared_at FROM users WHERE id = ?', [req.uid]);
    const lastClearedAt = user?.chat_last_cleared_at || '1970-01-01 00:00:00';

    const params = [req.uid, lastClearedAt];
    let where = 'WHERE m.user_id = ? AND m.created_at > ? AND s.is_temporary = 0 AND m.content NOT LIKE ?';
    params.push(`${AMBIENT_HIDDEN_USER_PREFIX}%`);

    if (sessionKey) {
      where += ' AND s.session_key = ?';
      params.push(sessionKey);
    }

    const [rows] = await db.query(
      `SELECT m.*, s.session_key 
       FROM chat_messages m
       JOIN chat_sessions s ON m.session_id = s.id
       ${where}
       ORDER BY m.created_at DESC LIMIT ${limit}`,
      params
    );

    const candidateMap = await listCandidatesForMessages({
      userId: req.uid,
      messageIds: rows.map((row) => row.id),
    });
    const practiceSuggestionMap = await hydratePracticeSuggestions({ userId: req.uid, rows });
    
    const history = rows.map(r => ({
      id: r.id,
      role: r.role,
      content: r.content,
      voiceId: r.voice_id,
      attachments: safeParse(r.attachments, []),
      scheduleCandidates: candidateMap.get(r.id) || [],
      practiceSuggestions: practiceSuggestionMap.get(r.id) || [],
      ts: r.created_at,
      sessionId: r.session_key
    })).reverse();

    res.json({ history });
  } catch (err) {
    console.error('[Chat] History error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// POST /api/chat/message
router.post('/message', auth, upload.array('files', 5), async (req, res) => {
  try {
    let { content, sessionId, aiChatUrl } = req.body;
    const files = req.files || [];
    content = (content || "").trim();
    aiChatUrl = (aiChatUrl || "").trim();
    const temporaryChat = String(req.body?.temporaryChat || '').toLowerCase() === 'true';
    
    if (!content && files.length === 0 && !aiChatUrl) {
      return res.status(400).json({ error: 'Message or files required' });
    }

    const result = await processChatTurn({
      userId: req.uid,
      content,
      sessionKey: sessionId,
      uploadedFiles: files,
      importedUrl: aiChatUrl,
      temporaryChat,
    });

    res.json(result);
  } catch (err) {
    console.error('[Chat] Critical Error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Chat failed' });
  }
});

router.post('/messages/:messageId/practice-suggestions', auth, async (req, res) => {
  try {
    await ensureChatSchema();
    const messageId = Number(req.params.messageId);
    const suggestions = Array.isArray(req.body?.suggestions) ? req.body.suggestions : [];
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return res.status(400).json({ error: 'Invalid message id' });
    }

    const [rows] = await db.query(
      'SELECT id FROM chat_messages WHERE id = ? AND user_id = ? LIMIT 1',
      [messageId, req.uid]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Message not found' });
    }

    await db.query(
      `UPDATE chat_messages
       SET practice_suggestions_json = ?
       WHERE id = ? AND user_id = ?`,
      [JSON.stringify(suggestions), messageId, req.uid]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[Chat] Practice suggestion sync error:', err);
    res.status(500).json({ error: 'Failed to sync practice suggestions' });
  }
});

// DELETE /api/chat/history
router.delete('/history', auth, async (req, res) => {
  try {
    await ensureChatSchema();
    await db.query('UPDATE users SET chat_last_cleared_at = NOW() WHERE id = ?', [req.uid]);
    res.json({ success: true, message: 'History cleared (soft)' });
  } catch (err) {
    console.error('[Chat] Clear history error:', err);
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

module.exports = router;
