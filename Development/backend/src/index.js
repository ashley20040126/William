require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const debugRoutes = require('./routes/debug');
const voiceRoutes = require('./routes/voice');
const userRoutes = require('./routes/user');
const journeyRoutes = require('./routes/journey');
const { warmupDigitalExpertService } = require('./services/ragService');
const { warmupVoiceService } = require('./services/voiceService');
const { ensureChatSchema } = require('./services/chatSchemaService');
const { ensureMemorySchema } = require('./services/memoryService');
const { ensureAttachmentSchema } = require('./services/attachmentService');
const { ensureScheduleCandidateSchema } = require('./services/scheduleCandidateService');
const { ensureAmbientListeningSchema } = require('./services/ambientListeningService');
const { ensureWellbeingSchema } = require('./services/userWellbeingService');
const { ensureInterventionSchema } = require('./services/interventionService');

const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──
app.use(helmet({
  crossOriginResourcePolicy: false, // Allow loading images from our own server
}));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rate limiting
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
const voiceDefaultLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  skip: (req) => (
    req.path === '/transcribe-chunk'
    || req.path === '/ambient-listening-audio'
  ),
});
const voiceStreamingLimiter = rateLimit({ windowMs: 60 * 1000, max: 300 });

app.use('/api/auth', authLimiter);
app.use('/api/chat', chatLimiter);
app.use('/api/voice/transcribe-chunk', voiceStreamingLimiter);
app.use('/api/voice/ambient-listening-audio', voiceStreamingLimiter);
app.use('/api/voice', voiceDefaultLimiter);

// ── Demo Mode (must be mounted before real routes) ──
if (process.env.DEMO_MODE === 'true') {
  const demoRouter = require('./routes/demoRouter');
  app.use(demoRouter);
  console.log('[Demo] DEMO_MODE enabled — scripted responses active');
}

// ── Routes ──
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/user', userRoutes);
app.use('/api/journey', journeyRoutes);

// Health check
app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Error handler ──
app.use((err, _req, res, _next) => {
  console.error('[Server]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[William] Server running on port ${PORT}`);
  ensureChatSchema().catch((err) => {
    console.error(`[Chat] Schema initialization failed: ${err.message}`);
  });
  ensureMemorySchema().catch((err) => {
    console.error(`[Memory] Schema initialization failed: ${err.message}`);
  });
  ensureAttachmentSchema().catch((err) => {
    console.error(`[Attachment] Schema initialization failed: ${err.message}`);
  });
  ensureScheduleCandidateSchema().catch((err) => {
    console.error(`[Schedule] Schema initialization failed: ${err.message}`);
  });
  ensureAmbientListeningSchema().catch((err) => {
    console.error(`[Ambient Listening] Schema initialization failed: ${err.message}`);
  });
  ensureWellbeingSchema().catch((err) => {
    console.error(`[Wellbeing] Schema initialization failed: ${err.message}`);
  });
  ensureInterventionSchema().catch((err) => {
    console.error(`[Intervention] Schema initialization failed: ${err.message}`);
  });
  warmupDigitalExpertService().catch((err) => {
    console.error(`[RAG Service] Warmup failed: ${err.message}`);
  });
  warmupVoiceService().catch((err) => {
    console.error(`[Voice Service] Warmup failed: ${err.message}`);
  });
});
