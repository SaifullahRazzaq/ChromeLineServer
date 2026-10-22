import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { auth, signToken } from '../middleware/auth.js';
import { h, HttpError, bad } from '../utils/http.js';
import { can } from '../utils/permissions.js';

const r = Router();

const present = (u) => ({ ...u.toJSON(), can: Object.fromEntries(Object.entries(can).map(([k, fn]) => [k, !!fn(u)])) });

// Naive in-memory throttle: 8 failures per email+ip per 10 minutes
const fails = new Map();
const throttleKey = (req) => `${(req.body.email || '').toLowerCase()}|${req.ip}`;

r.post('/login', h(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw bad('Email and password are required');
  const key = throttleKey(req);
  const rec = fails.get(key);
  if (rec && rec.count >= 8 && Date.now() - rec.at < 600000) throw new HttpError(429, 'Too many attempts. Try again later.');
  const user = await User.findOne({ email: String(email).toLowerCase() }).select('+passwordHash');
  const ok = user?.active && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    fails.set(key, { count: (rec && Date.now() - rec.at < 600000 ? rec.count : 0) + 1, at: Date.now() });
    throw new HttpError(401, 'Invalid email or password');
  }
  fails.delete(key);
  res.json({ token: signToken(user), user: present(user) });
}));

r.get('/me', auth, (req, res) => res.json(present(req.user)));

r.post('/password', auth, h(async (req, res) => {
  const { current, next } = req.body;
  if (!next || next.length < 8) throw bad('New password must be 8+ characters');
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(current || '', user.passwordHash))) throw new HttpError(401, 'Current password is wrong');
  user.passwordHash = await bcrypt.hash(next, 10);
  await user.save();
  res.json({ ok: true });
}));

export default r;
