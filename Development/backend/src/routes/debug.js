const { Router } = require('express');
const { auth } = require('../middleware/auth');
const memory = require('../services/memoryService');
const interventionService = require('../services/interventionService');

const router = Router();
const DEBUG_ENABLED = process.env.DEBUG_MEMORY_API_ENABLED === 'true' || process.env.NODE_ENV !== 'production';

router.use(auth);
router.use((req, res, next) => {
  if (!DEBUG_ENABLED) {
    return res.status(404).json({ error: 'Debug API disabled' });
  }
  next();
});

router.get('/memory/session/:sessionKey', async (req, res) => {
  try {
    const snapshot = await memory.getSessionDebugSnapshot({
      userId: req.uid,
      sessionKey: req.params.sessionKey,
    });

    if (!snapshot) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(snapshot);
  } catch (error) {
    console.error('[Debug][Memory] Session snapshot error:', error);
    res.status(500).json({ error: 'Failed to load session memory snapshot' });
  }
});

router.get('/memory/user', async (req, res) => {
  try {
    const memories = await memory.listUserMemories({
      userId: req.uid,
      scope: req.query.scope || null,
      memoryType: req.query.memoryType || null,
      status: req.query.status || null,
      limit: req.query.limit || 100,
    });
    const activeLoops = await memory.listUserActiveLoops({
      userId: req.uid,
      status: req.query.loopStatus || 'active',
      limit: req.query.loopLimit || 30,
    });
    const interventionOverview = await interventionService.getUserInterventionOverview({
      userId: req.uid,
      limit: req.query.interventionLimit || 10,
    });

    res.json({ memories, activeLoops, interventionOverview });
  } catch (error) {
    console.error('[Debug][Memory] User memories error:', error);
    res.status(500).json({ error: 'Failed to load user memories' });
  }
});

router.get('/memory/context', async (req, res) => {
  try {
    const { sessionKey, sessionId, mode = 'classic' } = req.query;
    const snapshot = await memory.getSessionDebugSnapshot({
      userId: req.uid,
      sessionKey: sessionKey || null,
      sessionId: sessionId ? Number(sessionId) : null,
    });

    if (!snapshot) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const injectedContext = mode === 'direct' ? snapshot.injectedContext.direct : snapshot.injectedContext.classic;
    res.json({
      session: snapshot.session,
      mode,
      context: injectedContext,
    });
  } catch (error) {
    console.error('[Debug][Memory] Context error:', error);
    res.status(500).json({ error: 'Failed to load injected context' });
  }
});

router.post('/memory/rebuild-session', async (req, res) => {
  try {
    const result = await memory.rebuildSessionMemories({
      userId: req.uid,
      sessionKey: req.body.sessionKey || null,
      sessionId: req.body.sessionId || null,
    });

    res.json({ ok: true, result });
  } catch (error) {
    console.error('[Debug][Memory] Rebuild session error:', error);
    res.status(500).json({ error: error.message || 'Failed to rebuild session memories' });
  }
});

router.post('/memory/reextract-user', async (req, res) => {
  try {
    const result = await memory.reextractUserMemories({
      userId: req.uid,
      sessionKey: req.body.sessionKey || null,
      sessionId: req.body.sessionId || null,
    });

    res.json({ ok: true, result });
  } catch (error) {
    console.error('[Debug][Memory] Reextract user error:', error);
    res.status(500).json({ error: error.message || 'Failed to reextract user memories' });
  }
});

router.patch('/memory/:memoryId', async (req, res) => {
  try {
    const result = await memory.updateUserMemoryStatus({
      userId: req.uid,
      memoryId: Number(req.params.memoryId),
      status: req.body.status,
    });

    res.json({ ok: true, result });
  } catch (error) {
    console.error('[Debug][Memory] Update status error:', error);
    res.status(400).json({ error: error.message || 'Failed to update memory status' });
  }
});

module.exports = router;
