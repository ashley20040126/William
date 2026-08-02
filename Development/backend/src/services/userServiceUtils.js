const db = require('../utils/db');

function safeJsonParse(value, fallback = null) {
  try {
    if (value == null || value === '') return fallback;
    if (typeof value === 'string') return JSON.parse(value);
    if (typeof value === 'object') return value;
    return fallback;
  } catch {
    return fallback;
  }
}

function validateNumberParam(param, min = 1, max = 90, defaultValue = 7) {
  const num = Number(param);
  return !Number.isNaN(num) && num >= min && num <= max ? num : defaultValue;
}

async function withTransaction(work) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  safeJsonParse,
  validateNumberParam,
  withTransaction,
  createServiceError,
};
