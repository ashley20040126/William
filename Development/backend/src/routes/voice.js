const { Router } = require('express');
const crypto = require('crypto');
const multer = require('multer');

const { auth } = require('../middleware/auth');
const { transcribeAudioBuffer, analyzeAudioBuffer } = require('../services/voiceService');
const { synthesizeSpeech } = require('../services/ttsService');
const { processChatTurn } = require('../services/chatService');
const { recordAmbientListeningEvent, finalizeAmbientListeningSession } = require('../services/ambientListeningService');
const { getUserProfile } = require('../services/userProfileService');

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Only audio uploads are supported.'));
  },
});

function logVoiceError(scope, error) {
  const detail = getVoiceErrorDetail(error);
  console.error(`[Voice] ${scope}: ${detail}`);
}

function isRecoverableChunkDecodeError(error) {
  const detail = getVoiceErrorDetail(error);
  return (
    detail.includes('Invalid data found when processing input')
    || detail.includes('EBML header parsing failed')
    || detail.includes('Error opening input file')
  );
}

function isRecoverableChunkTimeout(error) {
  return error?.code === 'ECONNABORTED'
    || String(error?.message || '').toLowerCase().includes('timeout');
}

router.post('/transcribe', auth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file required' });
    }

    const transcript = await transcribeAudioBuffer(req.file.buffer, {
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    res.json(transcript);
  } catch (error) {
    logVoiceError('Transcribe error', error);
    res.status(500).json({ error: error.message || 'Failed to transcribe audio' });
  }
});

router.post('/transcribe-chunk', auth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file required' });
    }

    const transcript = await transcribeAudioBuffer(req.file.buffer, {
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      timeoutMs: 12000,
    });

    if (isIgnoredChunkTranscript(transcript)) {
      return res.json({
        ...transcript,
        ignored: true,
      });
    }

    res.json(transcript);
  } catch (error) {
    if (isRecoverableChunkDecodeError(error) || isRecoverableChunkTimeout(error)) {
      return res.json({
        text: '',
        duration_ms: 0,
        language: null,
        ignored: true,
      });
    }
    logVoiceError('Chunk transcribe error', error);
    res.status(500).json({ error: error.message || 'Failed to transcribe audio chunk' });
  }
});

router.post('/call-turn-text', auth, async (req, res) => {
  try {
    const transcript = String(req.body?.transcript || '').trim();
    const temporaryChat = String(req.body?.temporaryChat || '').toLowerCase() === 'true';
    if (!transcript) {
      return res.status(400).json({ error: 'Transcript required' });
    }

    const chatResult = await processChatTurn({
      userId: req.uid,
      content: transcript,
      sessionKey: req.body.sessionId,
      analysis: null,
      temporaryChat,
    });

    res.json({
      transcript,
      reply: chatResult.reply,
      sessionId: chatResult.sessionId,
      analysis: chatResult.analysis,
      voice: {
        durationMs: null,
        language: null,
      },
    });
  } catch (error) {
    logVoiceError('Call text turn error', error);
    res.status(500).json({ error: error.message || 'Failed to process voice text turn' });
  }
});

router.post('/tts', auth, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Text required' });
    }

    const result = await synthesizeSpeech(text, {
      language: typeof req.body?.language === 'string' ? req.body.language : undefined,
    });

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-TTS-Language', result.language);
    res.setHeader('X-TTS-Voice', result.voiceName);
    res.send(result.audioBuffer);
  } catch (error) {
    logVoiceError('TTS error', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to synthesize speech' });
  }
});

router.post('/ambient-listening', auth, async (req, res) => {
  try {
    const transcript = String(req.body?.transcript || '').trim();
    if (!transcript) {
      return res.status(400).json({ error: 'Transcript required' });
    }

    const result = await recordAmbientListeningEvent({
      userId: req.uid,
      transcript,
      sourcePage: typeof req.body?.sourcePage === 'string' ? req.body.sourcePage : 'chat',
      sourceSessionKey: typeof req.body?.sourceSessionKey === 'string' ? req.body.sourceSessionKey : '',
    });

    res.json(result);
  } catch (error) {
    logVoiceError('Ambient listening error', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to persist ambient listening event' });
  }
});

router.post('/ambient-listening-audio', auth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file required' });
    }

    const profile = await getUserProfile(req.uid);
    const ambientASREnabled = profile?.ambient_asr_enabled == null ? true : Boolean(Number(profile.ambient_asr_enabled));
    const eventHash = crypto.createHash('sha1').update(req.file.buffer).digest('hex');

    const analyzed = await analyzeAudioBuffer(req.file.buffer, {
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      skipTranscription: !ambientASREnabled,
    });

    const transcript = String(analyzed.text || '').trim();
    if (ambientASREnabled && isAmbientTranscriptTooShort(transcript)) {
      return res.status(422).json({ error: 'No speech detected', transcript: '' });
    }
    if (!ambientASREnabled && !analyzed.speech_detected) {
      return res.status(422).json({ error: 'No speech detected', transcript: '' });
    }

    const result = await recordAmbientListeningEvent({
      userId: req.uid,
      transcript: ambientASREnabled ? transcript : '',
      eventHash,
      sourcePage: typeof req.body?.sourcePage === 'string' ? req.body.sourcePage : 'chat',
      sourceSessionKey: typeof req.body?.sourceSessionKey === 'string' ? req.body.sourceSessionKey : '',
      analysis: {
        emotion: analyzed.dominant_emotion,
        stress: analyzed.voice_stress,
        patterns: [],
        topics: [],
        tokenCount: estimateAmbientTokenCount(transcript),
        speechPace: analyzed.speech_pace_tpm,
        stability: analyzed.emotional_stability,
        vocalVitality: analyzed.vocal_vitality,
        flags: Array.isArray(analyzed.flags) ? analyzed.flags : [],
        durationMs: analyzed.duration_ms,
      },
    });

    res.json({
      ...result,
      transcript: ambientASREnabled ? transcript : '',
      asrEnabled: ambientASREnabled,
      voice: {
        durationMs: analyzed.duration_ms || null,
        speechDetected: Boolean(analyzed.speech_detected),
        speechPace: analyzed.speech_pace_tpm ?? null,
        stability: analyzed.emotional_stability ?? null,
        vocalVitality: analyzed.vocal_vitality ?? null,
        dominantEmotion: analyzed.dominant_emotion || null,
        flags: Array.isArray(analyzed.flags) ? analyzed.flags : [],
      },
    });
  } catch (error) {
    logVoiceError('Ambient listening audio error', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to analyze ambient listening audio' });
  }
});

router.post('/ambient-listening-finalize', auth, async (req, res) => {
  try {
    const startedAt = typeof req.body?.startedAt === 'string' ? req.body.startedAt : '';
    if (!startedAt) {
      return res.status(400).json({ error: 'startedAt required' });
    }

    const result = await finalizeAmbientListeningSession({
      userId: req.uid,
      startedAt,
      sourceSessionKey: typeof req.body?.sourceSessionKey === 'string' ? req.body.sourceSessionKey : '',
    });

    res.json(result);
  } catch (error) {
    logVoiceError('Ambient listening finalize error', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to finalize ambient listening session' });
  }
});

function isAmbientTranscriptTooShort(transcript) {
  return String(transcript || '').replace(/\s+/g, ' ').trim().length < 6;
}

function estimateAmbientTokenCount(transcript) {
  const normalized = String(transcript || '').trim();
  if (!normalized) return 0;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const cjkCount = (normalized.match(/[\u4e00-\u9fff]/g) || []).length;
  return Math.max(wordCount, cjkCount, 1);
}

function isIgnoredChunkTranscript(transcript) {
  const text = String(transcript?.text || '').trim();
  const durationMs = Number(transcript?.duration_ms || 0);
  return !text && durationMs <= 0;
}

function getVoiceErrorDetail(error) {
  return String(
    error?.response?.data?.detail
    || error?.response?.data?.error
    || error?.message
    || ''
  );
}

router.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Audio file too large. Please keep it under 15MB.' });
  }
  if (error?.message === 'Only audio uploads are supported.') {
    return res.status(400).json({ error: error.message });
  }
  return next(error);
});

module.exports = router;
