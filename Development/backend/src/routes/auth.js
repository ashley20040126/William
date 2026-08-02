const { Router } = require('express');
const bcrypt = require('bcryptjs');
const db = require('../utils/db');
const { signToken, auth } = require('../middleware/auth');

const router = Router();

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.execute(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [email.toLowerCase().trim(), hash, name || '']
    );
    const token = signToken(result.insertId);
    res.json({ token, uid: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already registered' });
    console.error('[Auth] Signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const [rows] = await db.execute('SELECT id, password, name, onboarded FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(rows[0].id);
    await db.execute('UPDATE users SET last_active = NOW() WHERE id = ?', [rows[0].id]);
    res.json({ token, uid: rows[0].id, name: rows[0].name, onboarded: !!rows[0].onboarded });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/guest — create anonymous account, returns token
router.post('/guest', async (req, res) => {
  try {
    const guestKey = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const hash = await bcrypt.hash(guestKey, 8);
    const [result] = await db.execute(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [`${guestKey}@william.guest`, hash, 'Friend']
    );
    const token = signToken(result.insertId);
    res.json({ token, uid: result.insertId, guest: true });
  } catch (err) {
    console.error('[Auth] Guest error:', err);
    res.status(500).json({ error: 'Guest auth failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', auth, async (req, res) => {
  try {
    await db.execute('UPDATE users SET last_active = NOW() WHERE id = ?', [req.uid]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Auth] Logout error:', err);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// POST /api/auth/forgot-password — send 6-digit code
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const [rows] = await db.execute('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    // Always return success to prevent email enumeration
    if (rows.length === 0) return res.json({ ok: true });

    // Invalidate previous tokens for this email
    await db.execute('UPDATE password_reset_tokens SET used = 1 WHERE email = ? AND used = 0', [email.toLowerCase().trim()]);

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await db.execute(
      'INSERT INTO password_reset_tokens (email, token, expires_at) VALUES (?, ?, ?)',
      [email.toLowerCase().trim(), code, expiresAt]
    );

    // In production, send via email service. For now, return code in response (dev mode).
    const isDev = process.env.NODE_ENV !== 'production';
    console.log(`[Auth] Password reset code for ${email}: ${code}`);
    res.json({ ok: true, ...(isDev && { code }) });
  } catch (err) {
    console.error('[Auth] Forgot password error:', err);
    res.status(500).json({ error: 'Failed to send reset code' });
  }
});

// POST /api/auth/reset-password — verify code and set new password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ error: 'Email, code and newPassword required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const [rows] = await db.execute(
      'SELECT id FROM password_reset_tokens WHERE email = ? AND token = ? AND used = 0 AND expires_at > NOW()',
      [email.toLowerCase().trim(), code]
    );
    if (rows.length === 0) return res.status(400).json({ error: 'Invalid or expired code' });

    const hash = await bcrypt.hash(newPassword, 10);
    await db.execute('UPDATE users SET password = ? WHERE email = ?', [hash, email.toLowerCase().trim()]);
    await db.execute('UPDATE password_reset_tokens SET used = 1 WHERE email = ? AND token = ?', [email.toLowerCase().trim(), code]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[Auth] Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
