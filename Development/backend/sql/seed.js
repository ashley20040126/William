/**
 * Seed static William data.
 * Usage: node sql/seed.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function seed() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'william',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'william_app',
    multipleStatements: true,
  });

  const seeds = fs.readFileSync(path.join(__dirname, 'seeds.sql'), 'utf8');
  await conn.query(seeds);
  console.log('[DB] Seeds applied successfully');
  await conn.end();
}

seed().catch((err) => {
  console.error('[DB] Seed failed:', err.message);
  process.exit(1);
});
