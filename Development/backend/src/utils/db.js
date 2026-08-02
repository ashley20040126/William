const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'root',
  database: process.env.DB_NAME || 'william_app',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+00:00',
});

// Test connection on startup
pool.getConnection()
  .then(conn => { console.log('[DB] MySQL connected'); conn.release(); })
  .catch(err => { console.error('[DB] MySQL failed:', err.message); process.exit(1); });

module.exports = pool;
