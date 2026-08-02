const { Router } = require('express');
const db = require('../utils/db');
const { auth } = require('../middleware/auth');
const { getUserSkills } = require('../services/journeySkillService');
const {
  listCandidatesForUser,
  confirmCandidate,
  dismissCandidate,
  updateCandidate,
} = require('../services/scheduleCandidateService');
const { getDailyStory, getRecentStories } = require('../services/storyGeneratorService');
const {
  getUserMilestones,
  checkJourneyMilestone,
} = require('../services/milestoneService');
const { safeJsonParse } = require('../services/userServiceUtils');
const interventionService = require('../services/interventionService');

const router = Router();

// GET /api/journey/paths — all journey path definitions (ordered)
router.get('/paths', auth, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM journey_paths ORDER BY sort_order');
    const paths = rows.map((row) => ({
      id: row.id,
      title: row.title,
      parts: row.parts,
      icon: row.icon,
      gradient: safeJsonParse(row.gradient, ['#8B7FCC', '#C4527A']),
      steps: safeJsonParse(row.steps, []),
    }));
    res.json(paths);
  } catch (error) {
    console.error('[Journey] Paths error:', error);
    res.status(500).json({ error: 'Failed to fetch journey paths' });
  }
});

// GET /api/journey/practices — practice definitions grouped by slot
router.get('/practices', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM practices ORDER BY slot, sort_order'
    );
    const bySlot = {};
    for (const row of rows) {
      if (!bySlot[row.slot]) bySlot[row.slot] = [];
      bySlot[row.slot].push({
        id: row.id,
        slot: row.slot,
        icon: row.icon,
        name: row.name,
        desc: row.description,
        type: row.type,
        mins: row.mins,
      });
    }
    res.json(bySlot);
  } catch (error) {
    console.error('[Journey] Practices error:', error);
    res.status(500).json({ error: 'Failed to fetch practices' });
  }
});

// GET /api/journey — list enrollments
router.get('/', auth, async (req, res) => {
  const [rows] = await db.execute(
    'SELECT * FROM journey_enrollments WHERE user_id = ? ORDER BY started_at DESC',
    [req.uid]
  );
  res.json(rows);
});

// GET /api/journey/daily-story?date=YYYY-MM-DD — get or generate today's narrative
// If date is omitted, defaults to today. Pass ?days=7 to get recent N stories.
router.get('/daily-story', auth, async (req, res) => {
  try {
    const days = req.query.days ? parseInt(String(req.query.days), 10) : null;

    if (days && days > 1) {
      const stories = await getRecentStories(req.uid, Math.min(days, 30));
      return res.json(stories);
    }

    const dateKey = typeof req.query.date === 'string' && req.query.date.trim()
      ? req.query.date.trim()
      : new Date().toISOString().slice(0, 10);

    const story = await getDailyStory(req.uid, dateKey);
    res.json(story);
  } catch (error) {
    console.error('[Journey] Daily story error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to generate story' });
  }
});

// GET /api/journey/skills — user's persistent skill toolkit
router.get('/skills', auth, async (req, res) => {
  try {
    const skills = await getUserSkills(req.uid);
    res.json(skills);
  } catch (error) {
    console.error('[Journey] Skills error:', error);
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

// GET /api/journey/milestones — user's earned milestones
router.get('/milestones', auth, async (req, res) => {
  try {
    const milestones = await getUserMilestones(req.uid);
    res.json(milestones);
  } catch (error) {
    console.error('[Journey] Milestones error:', error);
    res.status(500).json({ error: 'Failed to fetch milestones' });
  }
});

// POST /api/journey/enroll — enroll or re-activate a journey
router.post('/enroll', auth, async (req, res) => {
  const { journeyId } = req.body;
  if (!journeyId) return res.status(400).json({ error: 'journeyId required' });

  await db.execute(
    `INSERT INTO journey_enrollments (user_id, journey_id, current_step)
     VALUES (?, ?, 0)
     ON DUPLICATE KEY UPDATE current_step = 0, completed_at = NULL, started_at = NOW()`,
    [req.uid, journeyId]
  );
  const [rows] = await db.execute(
    'SELECT * FROM journey_enrollments WHERE user_id = ? AND journey_id = ?',
    [req.uid, journeyId]
  );

  checkJourneyMilestone(req.uid).catch((err) =>
    console.error('[Journey] Milestone check error:', err.message)
  );

  res.json(rows[0]);
});

// POST /api/journey/progress — advance step
router.post('/progress', auth, async (req, res) => {
  const { journeyId, step, totalSteps } = req.body;
  if (!journeyId || step == null) return res.status(400).json({ error: 'journeyId and step required' });

  const completed = totalSteps && step >= totalSteps - 1 ? new Date() : null;
  await db.execute(
    `UPDATE journey_enrollments SET current_step = ?, completed_at = ?
     WHERE user_id = ? AND journey_id = ?`,
    [step, completed, req.uid, journeyId]
  );
  if (completed) {
    await db.execute('UPDATE users SET xp = xp + 100 WHERE id = ?', [req.uid]);
  }
  res.json({ ok: true, completed: !!completed });
});

// ── Schedule candidates (used by ChatScreen / TodayScreen) ──────────────────

router.get('/schedule-candidates', auth, async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' && req.query.status.trim()
      ? req.query.status.trim()
      : 'candidate';
    const rows = await listCandidatesForUser({ userId: req.uid, status, limit: req.query.limit });
    res.json(rows);
  } catch (error) {
    console.error('[Journey] Schedule candidates error:', error);
    res.status(500).json({ error: 'Failed to fetch schedule candidates' });
  }
});

router.post('/schedule-candidates/:id/confirm', auth, async (req, res) => {
  try {
    const candidate = await confirmCandidate({ userId: req.uid, candidateId: req.params.id });
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    interventionService.recordBehaviorEvent({
      userId: req.uid,
      eventType: 'schedule_confirmed',
      eventPayload: {
        candidateId: candidate.id,
      },
    }).catch((error) => {
      console.error('[Journey] Intervention schedule outcome error:', error.message);
    });
    res.json(candidate);
  } catch (error) {
    console.error('[Journey] Confirm schedule candidate error:', error);
    res.status(500).json({ error: 'Failed to confirm schedule candidate' });
  }
});

router.post('/schedule-candidates/:id/dismiss', auth, async (req, res) => {
  try {
    const candidate = await dismissCandidate({ userId: req.uid, candidateId: req.params.id });
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    res.json(candidate);
  } catch (error) {
    console.error('[Journey] Dismiss schedule candidate error:', error);
    res.status(500).json({ error: 'Failed to dismiss schedule candidate' });
  }
});

router.patch('/schedule-candidates/:id', auth, async (req, res) => {
  try {
    const candidate = await updateCandidate({
      userId: req.uid,
      candidateId: req.params.id,
      title: req.body?.title,
      dateText: req.body?.dateText,
      location: req.body?.location,
      notes: req.body?.notes,
    });
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    res.json(candidate);
  } catch (error) {
    console.error('[Journey] Edit schedule candidate error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to edit schedule candidate' });
  }
});

module.exports = router;
