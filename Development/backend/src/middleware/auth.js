const jwt = require('jsonwebtoken');
const db = require('../utils/db');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function signToken(userId) {
  return jwt.sign({ uid: userId }, SECRET, { expiresIn: '30d' });
}

async function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, SECRET);
    const [rows] = await db.execute('SELECT id FROM users WHERE id = ? LIMIT 1', [decoded.uid]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'User not found for token' });
    }
    req.uid = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { signToken, auth };
