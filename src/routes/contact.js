import { Router } from 'express';
import Inquiry, { SERVICES } from '../models/Inquiry.js';
import { auth, requireRole } from '../middleware/auth.js';
import { h, HttpError, bad, notFound } from '../utils/http.js';
import { notifyStaff } from '../services/notify.js';

const r = Router();

// Public endpoint: per-IP limit of 5 submissions per hour
const hits = new Map();
const limited = (ip) => {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (list.length >= 5) return true;
  hits.set(ip, [...list, now]);
  return false;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

r.post('/', h(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true }); // honeypot: bots fill hidden fields
  if (limited(req.ip)) throw new HttpError(429, 'Too many requests. Please call us instead.');
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim();
  const phone = String(b.phone || '').trim();
  const message = String(b.message || '').trim();
  if (!name || !phone || !message) throw bad('Name, phone and message are required');
  if (!EMAIL.test(email)) throw bad('Please enter a valid email address');
  if (!/^[+\d][\d\s\-()]{6,}$/.test(phone)) throw bad('Please enter a valid phone number');
  await Inquiry.create({ name, email, phone, message, vehicle: b.vehicle, service: SERVICES.includes(b.service) ? b.service : 'Other' });
  await notifyStaff({ type: 'system', title: 'New website inquiry', body: `${name} · ${b.service || 'General'}`, link: '/inquiries' });
  res.status(201).json({ ok: true });
}));

r.get('/', auth, requireRole('supervisor', 'admin'), h(async (req, res) => {
  const filter = req.query.status ? { status: req.query.status } : {};
  res.json(await Inquiry.find(filter).sort({ createdAt: -1 }).limit(200));
}));

r.patch('/:id', auth, requireRole('supervisor', 'admin'), h(async (req, res) => {
  if (!['new', 'contacted', 'closed'].includes(req.body.status)) throw bad('Invalid status');
  const i = await Inquiry.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
  if (!i) throw notFound('Inquiry');
  res.json(i);
}));

export default r;
