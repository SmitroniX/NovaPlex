import express from 'express';
import crypto from 'node:crypto';
import { db } from '../db/database.js';

const router = express.Router();

// Get all profiles
router.get('/', (req, res) => {
  try {
    const users = db.queryAll('SELECT id, username, is_admin, avatar, created_at, (pin IS NOT NULL AND pin != "") as has_pin FROM users ORDER BY is_admin DESC, username ASC');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users', message: err.message });
  }
});

// Authenticate profile with PIN
router.post('/auth', (req, res) => {
  try {
    const { userId, pin } = req.body;
    const user = db.queryOne('SELECT * FROM users WHERE id = ?', [userId]);

    if (!user) return res.status(404).json({ error: 'User profile not found' });

    if (!user.pin || user.pin === '') {
      return res.json({ success: true, user: { id: user.id, username: user.username, isAdmin: Boolean(user.is_admin), avatar: user.avatar } });
    }

    if (user.pin !== String(pin)) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    res.json({ success: true, user: { id: user.id, username: user.username, isAdmin: Boolean(user.is_admin), avatar: user.avatar } });
  } catch (err) {
    res.status(500).json({ error: 'Authentication failed', message: err.message });
  }
});

// Create new user profile
router.post('/', (req, res) => {
  try {
    const { username, pin = '', isAdmin = false, avatar } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const id = `user-${crypto.randomBytes(4).toString('hex')}`;
    const defaultAvatar = avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80';

    db.run(
      'INSERT INTO users (id, username, pin, is_admin, avatar) VALUES (?, ?, ?, ?, ?)',
      [id, username.trim(), pin ? String(pin) : '', isAdmin ? 1 : 0, defaultAvatar]
    );

    const created = db.queryOne('SELECT id, username, is_admin, avatar, (pin IS NOT NULL AND pin != "") as has_pin FROM users WHERE id = ?', [id]);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create user', message: err.message });
  }
});

export default router;
