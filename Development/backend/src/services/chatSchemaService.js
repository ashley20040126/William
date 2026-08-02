const db = require('../utils/db');

async function ensureColumn(tableName, columnName, alterSql) {
  const [rows] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
  if (rows.length === 0) {
    await db.query(alterSql);
  }
}

async function ensureChatSchema() {
  await ensureColumn(
    'users',
    'chat_last_cleared_at',
    'ALTER TABLE users ADD COLUMN chat_last_cleared_at TIMESTAMP NULL DEFAULT NULL'
  );
  await ensureColumn(
    'chat_sessions',
    'is_temporary',
    'ALTER TABLE chat_sessions ADD COLUMN is_temporary TINYINT(1) NOT NULL DEFAULT 0 AFTER session_key'
  );
  await ensureColumn(
    'chat_messages',
    'practice_suggestions_json',
    'ALTER TABLE chat_messages ADD COLUMN practice_suggestions_json JSON NULL AFTER analysis'
  );
}

module.exports = {
  ensureChatSchema,
};
