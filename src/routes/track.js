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

// Public, exact match on order number AND plate so a status can't be guessed from one value
r.post('/', h(async (req, res) => {
  if (limited(req.ip)) throw new HttpError(429, 'Too many lookups. Please try again later or call us.');
  const orderNo = norm(req.body.orderNo);
  const plate = norm(req.body.plate);
  if (!orderNo || !plate) throw bad('Enter your order number and number plate');
  const jobs = await Job.find({}).select('orderNo vehicle.plate vehicle.make vehicle.model vehicle.year status progress deadline updatedAt createdAt').lean();
  const job = jobs.find((j) => norm(j.orderNo) === orderNo && norm(j.vehicle?.plate) === plate);
  if (!job) throw new HttpError(404, 'We could not find a repair matching those details. Check your order number and plate.');
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
