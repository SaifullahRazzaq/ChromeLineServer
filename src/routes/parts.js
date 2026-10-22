import { Router } from 'express';
import { Part, PartRequest } from '../models/Part.js';
import Job from '../models/Job.js';
import { auth, requireRole } from '../middleware/auth.js';
import { h, bad, notFound, forbidden } from '../utils/http.js';
import { isStaffRole } from '../utils/permissions.js';
import { notify, notifyStaff } from '../services/notify.js';
import { emitAll } from '../services/realtime.js';

const r = Router();
r.use(auth);

// Catalog + availability
r.get('/', h(async (req, res) => {
  const filter = {};
  if (req.query.q) filter.$or = [{ name: new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { sku: new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
  const parts = await Part.find(filter).sort({ name: 1 }).limit(100);
  res.json(parts.map((p) => ({ ...p.toJSON(), available: Math.max(0, p.stock - p.reserved) })));
}));

r.post('/', requireRole('supervisor', 'admin'), h(async (req, res) => {
  res.status(201).json(await Part.create(req.body));
}));

r.patch('/:id', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const p = await Part.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!p) throw notFound('Part');
  res.json(p);
}));

// Requests
r.get('/requests', h(async (req, res) => {
  const filter = {};
  if (!isStaffRole(req.user)) filter.requestedBy = req.user._id;
  if (req.query.job) filter.job = req.query.job;
  if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
  res.json(await PartRequest.find(filter).populate('job', 'orderNo vehicle').populate('requestedBy', 'name').populate('part', 'sku stock').sort({ createdAt: -1 }).limit(200));
}));

r.post('/requests', h(async (req, res) => {
  const b = req.body;
  const job = await Job.findById(b.job);
  if (!job) throw notFound('Job');
  if (!isStaffRole(req.user) && String(job.technician) !== String(req.user._id)) throw forbidden('Job not assigned to you');
  const kind = b.kind || 'inventory';
  let name = b.name;
  let part;
  if (b.part) {
    part = await Part.findById(b.part);
    if (!part) throw notFound('Part');
    name = part.name;
  }
  if (!name) throw bad('Part name required');
  const qty = Math.max(1, Number(b.qty) || 1);
  const pr = await PartRequest.create({
    job: job._id, part: part?._id, name, qty, kind, note: b.note, requestedBy: req.user._id,
    statusLog: [{ status: 'requested', by: req.user._id }],
  });
  // Soft-reserve stock for inventory requests so two jobs can't claim the same units
  if (part && kind === 'inventory') await Part.updateOne({ _id: part._id }, { $inc: { reserved: qty } });
  const label = { inventory: 'Parts request', new: 'New part request', damaged: 'Damaged part reported', missing: 'Missing part reported' }[kind];
  await notifyStaff({ type: 'parts', title: label, body: `${job.orderNo}: ${qty} × ${name}`, link: '/parts' });
  emitAll('parts:updated', { id: pr._id });
  res.status(201).json(pr);
}));

const FLOW = { requested: ['approved', 'ordered', 'issued', 'rejected'], approved: ['ordered', 'issued', 'rejected'], ordered: ['issued', 'rejected'], issued: [], rejected: [] };

r.post('/requests/:id/status', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const pr = await PartRequest.findById(req.params.id);
  if (!pr) throw notFound('Request');
  const next = req.body.status;
  if (!FLOW[pr.status]?.includes(next)) throw bad(`Cannot move ${pr.status} → ${next}`);
  if (pr.part && pr.kind === 'inventory') {
    const part = await Part.findById(pr.part);
    if (next === 'issued') {
      if (part.stock < pr.qty) throw bad(`Only ${part.stock} in stock — mark as ordered instead`);
      part.stock -= pr.qty;
      part.reserved = Math.max(0, part.reserved - pr.qty);
      await part.save();
    } else if (next === 'rejected') {
      part.reserved = Math.max(0, part.reserved - pr.qty);
      await part.save();
    }
  }
  pr.status = next;
  pr.handledBy = req.user._id;
  pr.statusLog.push({ status: next, by: req.user._id });
  if (req.body.note) pr.note = req.body.note;
  await pr.save();
  const job = await Job.findById(pr.job);
  if (next === 'issued') {
    // Auto-link to the repair order's required parts and release any parts hold
    job.requiredParts.push({ part: pr.part, name: pr.name, qty: pr.qty });
    if (job.status === 'awaiting_parts') job.status = 'accepted';
    await job.save();
  }
  await notify(pr.requestedBy, { type: 'parts', title: `Parts ${next}`, body: `${job.orderNo}: ${pr.qty} × ${pr.name}`, link: '/parts' });
  emitAll('parts:updated', { id: pr._id });
  res.json(pr);
}));

export default r;
