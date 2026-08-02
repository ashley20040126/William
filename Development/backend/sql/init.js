/**
 * Initialize the William database schema.
 * Usage: node sql/init.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function init() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'william',
    password: process.env.DB_PASS || '',
    multipleStatements: true,
  });

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(schema);
  console.log('[DB] Schema initialized successfully');
  await conn.end();
}

init().catch(err => {
  console.error('[DB] Init failed:', err.message);
  process.exit(1);
});
