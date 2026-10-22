import { Router } from 'express';
import { Notification, Message } from '../models/Comms.js';
import Job from '../models/Job.js';
import { auth } from '../middleware/auth.js';
import { h, bad, forbidden } from '../utils/http.js';
import { isStaffRole } from '../utils/permissions.js';
import { upload, publish } from '../services/storage.js';
import { emitAll, emitToUser } from '../services/realtime.js';

const r = Router();
r.use(auth);

r.get('/notifications', h(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.unread === 'true') filter.read = false;
  const [items, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(Number(req.query.limit) || 50),
    Notification.countDocuments({ user: req.user._id, read: false }),
  ]);
  res.json({ items, unread });
}));

r.post('/notifications/read', h(async (req, res) => {
  const filter = { user: req.user._id, ...(req.body.ids?.length ? { _id: { $in: req.body.ids } } : {}) };
  await Notification.updateMany(filter, { read: true });
  res.json({ ok: true });
}));

async function assertChannel(req, channel) {
  if (channel === 'team') return;
  const m = /^job:([a-f0-9]{24})$/.exec(channel);
  if (!m) throw bad('Invalid channel');
  const job = await Job.findById(m[1]).select('technician');
  if (!job) throw bad('Unknown job');
  if (!isStaffRole(req.user) && String(job.technician) !== String(req.user._id)) throw forbidden();
}

r.get('/chat/:channel', h(async (req, res) => {
  await assertChannel(req, req.params.channel);
  const msgs = await Message.find({ channel: req.params.channel }).populate('sender', 'name role').sort({ createdAt: -1 }).limit(100);
  res.json(msgs.reverse());
}));

r.post('/chat/:channel', upload.array('files', 5), h(async (req, res) => {
  await assertChannel(req, req.params.channel);
  const text = String(req.body.text || '').trim();
  const urls = await Promise.all((req.files || []).map(publish));
  if (!text && !urls.length) throw bad('Message is empty');
  const msg = await Message.create({
    channel: req.params.channel, sender: req.user._id, text,
    attachments: (req.files || []).map((f, i) => ({ url: urls[i], name: f.originalname, mime: f.mimetype })),
  });
  const out = { ...msg.toJSON(), sender: { _id: req.user._id, name: req.user.name, role: req.user.role } };
  emitAll('chat:message', out);
  res.status(201).json(out);
}));

export default r;
