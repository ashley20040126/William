const db = require('../utils/db');
const { safeJsonParse } = require('./userServiceUtils');

let userTableColumnsPromise = null;
let ensuredProfileColumnsPromise = null;

async function getUserProfile(userId) {
  await ensureProfileColumns();
  const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [userId]);
  if (rows.length === 0) return null;

  const user = rows[0];
  delete user.password;
  ['challenges', 'trigs', 'perms'].forEach((field) => {
    user[field] = safeJsonParse(user[field], null);
  });
  if (!user.language) {
    user.language = 'zh-CN';
  }
  user.memory_enabled = user.memory_enabled == null ? 1 : Number(user.memory_enabled);
  user.ambient_asr_enabled = user.ambient_asr_enabled == null ? 1 : Number(user.ambient_asr_enabled);
  user.story_openai_api_key_configured = Boolean(String(user.story_openai_api_key || '').trim());
  user.story_openai_api_key_masked = maskApiKey(user.story_openai_api_key);
  delete user.story_openai_api_key;

  return user;
}

async function updateUserProfile(userId, payload) {
  await ensureProfileColumns();
  const fields = [
    'name', 'age', 'bio', 'avatar_color', 'challenges', 'sleep', 'work', 'trigs',
    'voice_mode', 'xp', 'streak', 'days_used', 'active_path', 'path_step', 'perms', 'onboarded', 'language',
    'memory_enabled', 'ambient_asr_enabled', 'story_openai_api_key',
  ];
  const supportedFields = await getSupportedProfileFields(fields);
  const updates = [];
  const values = [];

  for (const field of supportedFields) {
    const camelCase = field.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    const value = payload[field] !== undefined ? payload[field] : payload[camelCase];

    if (value !== undefined) {
      updates.push(`${field} = ?`);
      if (field === 'story_openai_api_key') {
        values.push(normalizeApiKeyValue(value));
      } else {
        values.push(typeof value === 'object' ? JSON.stringify(value) : value);
      }
    }
  }

  if (updates.length === 0) return { ok: true };

  values.push(userId);
  await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
  return { ok: true };
}

async function getSupportedProfileFields(fields) {
  const columns = await getUserTableColumns();
  return fields.filter((field) => columns.has(field));
}

async function ensureProfileColumns() {
  if (!ensuredProfileColumnsPromise) {
    ensuredProfileColumnsPromise = (async () => {
      const columns = await getUserTableColumns();
      if (!columns.has('story_openai_api_key')) {
        await db.query("ALTER TABLE users ADD COLUMN story_openai_api_key TEXT NULL AFTER ambient_asr_enabled");
        userTableColumnsPromise = null;
      }
    })().catch((error) => {
      ensuredProfileColumnsPromise = null;
      throw error;
    });
  }

  return ensuredProfileColumnsPromise;
}

async function getUserTableColumns() {
  if (!userTableColumnsPromise) {
    userTableColumnsPromise = db.execute('SHOW COLUMNS FROM users')
      .then(([rows]) => new Set(rows.map((row) => row.Field)))
      .catch((error) => {
        userTableColumnsPromise = null;
        throw error;
      });
  }
  return userTableColumnsPromise;
}

function normalizeApiKeyValue(value) {
  const normalized = String(value == null ? '' : value).trim();
  return normalized || null;
}

function maskApiKey(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (normalized.length <= 8) return '••••••••';
  return `${normalized.slice(0, 6)}••••${normalized.slice(-4)}`;
}

module.exports = {
  getUserProfile,
  updateUserProfile,
};
