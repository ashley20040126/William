const { Router } = require('express');
const { auth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getUserProfile, updateUserProfile } = require('../services/userProfileService');
const {
  saveMoodEntry,
  saveJournalEntry,
  addJournalAttachments,
  getJournalEntry,
  getTodayFeedData,
  logPracticeCompletion,
  getHistoryRows,
  getInsightsData,
  confirmAssistantPracticeSuggestion,
} = require('../services/userWellbeingService');
const {
  getUserMemoryOverview,
  changeUserMemoryStatus,
  changeUserActiveLoopStatus,
} = require('../services/userMemoryService');

const router = Router();

function handleRouteError(res, scope, err, validationMessage, fallbackMessage) {
  console.error(`[${scope}] Error:`, err);
  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  if (err.code === 'ER_WRONG_ARGUMENTS') {
    return res.status(400).json({ error: validationMessage });
  }
  return res.status(500).json({ error: fallbackMessage });
}

router.get('/profile', auth, async (req, res) => {
  try {
    const profile = await getUserProfile(req.uid);
    if (!profile) return res.status(404).json({ error: 'Not found' });
    res.json(profile);
  } catch (err) {
    handleRouteError(res, 'Profile Get', err, 'Invalid request parameters', 'Failed to get profile');
  }
});

router.post('/profile', auth, async (req, res) => {
  try {
    res.json(await updateUserProfile(req.uid, req.body));
  } catch (err) {
    handleRouteError(res, 'Profile Update', err, 'Invalid profile parameters', 'Failed to update profile');
  }
});

router.post('/mood', auth, async (req, res) => {
  try {
    res.json(await saveMoodEntry(req.uid, req.body));
  } catch (err) {
    handleRouteError(res, 'Mood Post', err, 'Invalid mood parameters', 'Failed to save mood');
  }
});

router.post('/journal', auth, async (req, res) => {
  try {
    res.json(await saveJournalEntry(req.uid, req.body));
  } catch (err) {
    handleRouteError(res, 'Journal Post', err, 'Invalid journal parameters', 'Failed to save journal');
  }
});

router.post('/journal/attachments', auth, upload.array('files', 6), async (req, res) => {
  try {
    res.json(await addJournalAttachments(req.uid, {
      date: req.body?.date,
      files: req.files,
    }));
  } catch (err) {
    handleRouteError(res, 'Journal Attachment Post', err, 'Invalid journal attachment parameters', 'Failed to upload journal attachments');
  }
});

router.get('/journal', auth, async (req, res) => {
  try {
    res.json(await getJournalEntry(req.uid, req.query.date));
  } catch (err) {
    handleRouteError(res, 'Journal Get', err, 'Invalid journal date', 'Failed to get journal');
  }
});

router.get('/today', auth, async (req, res) => {
  try {
    res.json(await getTodayFeedData(req.uid, req.query.date));
  } catch (err) {
    handleRouteError(res, 'Today Get', err, 'Invalid request parameters', 'Failed to build today feed');
  }
});

router.post('/practices', auth, async (req, res) => {
  try {
    res.json(await logPracticeCompletion(req.uid, req.body));
  } catch (err) {
    handleRouteError(res, 'Practice Post', err, 'Invalid practice parameters', 'Failed to log practice');
  }
});

router.post('/practice-suggestions/confirm', auth, async (req, res) => {
  try {
    res.json(await confirmAssistantPracticeSuggestion(req.uid, req.body));
  } catch (err) {
    handleRouteError(res, 'Practice Suggestion Confirm Post', err, 'Invalid practice suggestion parameters', 'Failed to confirm practice suggestion');
  }
});

router.get('/history', auth, async (req, res) => {
  try {
    res.json(await getHistoryRows(req.uid, req.query.days));
  } catch (err) {
    handleRouteError(res, 'History Get', err, 'Invalid days parameter (1-365)', 'Failed to get history');
  }
});

router.get('/insights', auth, async (req, res) => {
  try {
    res.json(await getInsightsData(req.uid, req.query.days));
  } catch (err) {
    handleRouteError(res, 'Insights Get', err, 'Invalid days parameter (1-90)', 'Failed to get insights');
  }
});

router.get('/memories', auth, async (req, res) => {
  try {
    res.json(await getUserMemoryOverview({
      userId: req.uid,
      limit: req.query.limit || 30,
    }));
  } catch (err) {
    handleRouteError(res, 'Memories Get', err, 'Invalid memory parameters', 'Failed to get memories');
  }
});

router.post('/memories/:memoryId/status', auth, async (req, res) => {
  try {
    res.json(await changeUserMemoryStatus({
      userId: req.uid,
      memoryId: Number(req.params.memoryId),
      status: String(req.body?.status || '').trim(),
    }));
  } catch (err) {
    handleRouteError(res, 'Memories Status Post', err, 'Invalid memory status', 'Failed to update memory');
  }
});

router.post('/active-loops/:loopId/status', auth, async (req, res) => {
  try {
    res.json(await changeUserActiveLoopStatus({
      userId: req.uid,
      loopId: Number(req.params.loopId),
      status: String(req.body?.status || '').trim(),
    }));
  } catch (err) {
    handleRouteError(res, 'Active Loops Status Post', err, 'Invalid active loop status', 'Failed to update active loop');
  }
});

module.exports = router;
