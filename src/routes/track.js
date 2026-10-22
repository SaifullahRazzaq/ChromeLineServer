import { Router } from 'express';
import Job from '../models/Job.js';
import { h, HttpError, bad } from '../utils/http.js';

const r = Router();

const hits = new Map();
const limited = (ip) => {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (list.length >= 20) return true;
  hits.set(ip, [...list, now]);
  return false;
};

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const digits = (s) => String(s || '').replace(/\D/g, '');
const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Matches "ro 1001", "RO-1001" and "1001" against the stored "RO-1001"
const orderRegex = (input) => {
  const raw = norm(input);
  const withPrefix = /^\d+$/.test(raw) ? `RO${raw}` : raw;
  return new RegExp(`^${[...withPrefix].map(esc).join('[\\s-]*')}$`, 'i');
};

const STAGES = [
  { id: 'received', label: 'Vehicle received', statuses: ['assigned', 'accepted'] },
  { id: 'repair', label: 'Repair in progress', statuses: ['in_progress', 'paused', 'awaiting_parts', 'rework'] },
  { id: 'quality', label: 'Quality check', statuses: ['ready_for_qc', 'qc_passed'] },
  { id: 'ready', label: 'Ready for pickup', statuses: ['ready_for_delivery'] },
];

const MESSAGE = {
  assigned: 'Your vehicle is checked in and queued for a technician.',
  accepted: 'A technician has taken your job and will start shortly.',
  in_progress: 'Our technicians are working on your vehicle right now.',
  paused: 'Work is briefly on hold. We will resume as soon as we can.',
  awaiting_parts: 'We are waiting for a part to arrive before continuing.',
  rework: 'We are making final refinements to meet our quality standard.',
  ready_for_qc: 'The repair is finished and is being inspected by a supervisor.',
  qc_passed: 'Inspection passed. We are doing final sign-off.',
  ready_for_delivery: 'Your vehicle is ready. Come and collect it!',
};

// Public lookup. Needs the order number AND a second factor (number plate or the phone number on the order),
// and answers every miss with the same message so order numbers cannot be probed.
r.post('/', h(async (req, res) => {
  if (limited(req.ip)) throw new HttpError(429, 'Too many lookups. Please try again later or call us.');
  const orderNo = String(req.body.orderNo || '').trim();
  const second = String(req.body.plate || req.body.phone || '').trim();
  if (!orderNo || !second) throw bad('Enter your order number and your number plate (or phone number)');
  const plate = norm(second);
  const phone = digits(second);
  const candidates = await Job.find({ orderNo: orderRegex(orderNo) })
    .select('orderNo vehicle.plate vehicle.make vehicle.model vehicle.year customer.phone status progress deadline updatedAt')
    .lean();
  const job = candidates.find((j) => (plate && norm(j.vehicle?.plate) === plate) || (phone.length >= 7 && digits(j.customer?.phone).endsWith(phone.slice(-9)) && digits(j.customer?.phone).length >= 7));
  if (!job) throw new HttpError(404, 'We could not find a repair matching those details. Check your order number and number plate, or call us.');
  const idx = STAGES.findIndex((s) => s.statuses.includes(job.status));
  res.json({
    orderNo: job.orderNo,
    vehicle: [job.vehicle.year, job.vehicle.make, job.vehicle.model].filter(Boolean).join(' '),
    status: job.status,
    message: MESSAGE[job.status],
    progress: job.progress,
    stages: STAGES.map((s, i) => ({ id: s.id, label: s.label, state: i < idx ? 'done' : i === idx ? 'current' : 'todo' })),
    estimatedReady: job.status === 'ready_for_delivery' ? null : job.deadline,
    updatedAt: job.updatedAt,
  });
}));

export default r;
