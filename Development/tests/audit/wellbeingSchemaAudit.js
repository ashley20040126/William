#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require(path.resolve(__dirname, '../../backend/node_modules/mysql2/promise'));
const dotenv = require(path.resolve(__dirname, '../../backend/node_modules/dotenv'));

dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const SCHEMA_PATH = path.resolve(__dirname, '../../backend/sql/schema.sql');
const WELLBEING_TABLES = [
  'badges',
  'practice_completions',
  'recovery_path_templates',
  'user_recovery_paths',
  'daily_ai_path_reviews',
  'recovery_path_tasks',
  'ai_practice_suggestions',
];

function buildPartialSchema(rawSchema) {
  let next = rawSchema
    .replace(/CREATE DATABASE IF NOT EXISTS william_app[\s\S]*?;/, '')
    .replace(/USE william_app;/, '');

  WELLBEING_TABLES.forEach((table) => {
    const pattern = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\) ENGINE=InnoDB;\\n*`, 'g');
    next = next.replace(pattern, '');
  });

  return next;
}

async function main() {
  const tempDb = `william_wellbeing_audit_${Date.now()}`;
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    multipleStatements: true,
  });

  let sharedDb = null;

  try {
    await admin.query(`CREATE DATABASE \`${tempDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.query(`USE \`${tempDb}\``);

    const rawSchema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    await admin.query(buildPartialSchema(rawSchema));

    process.env.DB_NAME = tempDb;

    const wellbeingService = require('../../backend/src/services/userWellbeingService');
    sharedDb = require('../../backend/src/utils/db');

    await wellbeingService.ensureWellbeingSchema();

    const tableChecks = [];
    for (const tableName of WELLBEING_TABLES) {
      const [rows] = await admin.execute(
        `SELECT COUNT(*) AS total
         FROM information_schema.tables
         WHERE table_schema = ? AND table_name = ?`,
        [tempDb, tableName]
      );
      tableChecks.push({ tableName, exists: Number(rows[0]?.total || 0) === 1 });
    }

    const expectedColumns = [
      ['user_recovery_paths', 'generation_source'],
      ['user_recovery_paths', 'origin_review_id'],
      ['user_recovery_paths', 'review_reason'],
      ['daily_ai_path_reviews', 'status'],
      ['ai_practice_suggestions', 'metadata_json'],
    ];

    const columnChecks = [];
    for (const [tableName, columnName] of expectedColumns) {
      const [rows] = await admin.execute(
        `SELECT COUNT(*) AS total
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
        [tempDb, tableName, columnName]
      );
      columnChecks.push({ tableName, columnName, exists: Number(rows[0]?.total || 0) === 1 });
    }

    const [inserted] = await sharedDb.execute(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [`wellbeing_audit_${Date.now()}@example.com`, 'audit_password_hash', 'Wellbeing Audit']
    );

    const feed = await wellbeingService.getTodayFeedData(inserted.insertId);
    const feedChecks = {
      hasMonthlyPaths: Array.isArray(feed.monthlyPaths) && feed.monthlyPaths.length > 0,
      hasPracticeTodos: Array.isArray(feed.practiceTodos) && feed.practiceTodos.length > 0,
      hasBadgesArray: Array.isArray(feed.badges),
    };

    const failures = [
      ...tableChecks.filter((item) => !item.exists),
      ...columnChecks.filter((item) => !item.exists),
    ].length + Object.values(feedChecks).filter((item) => !item).length;

    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      passed: failures === 0,
      database: tempDb,
      tableChecks,
      columnChecks,
      feedChecks,
    }, null, 2));

    if (failures > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (sharedDb) {
      await sharedDb.end();
    }
    await admin.query(`DROP DATABASE IF EXISTS \`${tempDb}\``);
    await admin.end();
  }
}

main().catch((error) => {
  console.error('[WellbeingSchemaAudit] Failed:', error);
  process.exit(1);
});
