import { Router } from 'express';
import { Part, PartRequest, StockMovement } from '../models/Part.js';
import Job from '../models/Job.js';
import { auth, requireRole } from '../middleware/auth.js';
import { h, bad, notFound, forbidden } from '../utils/http.js';
import { can, isStaffRole } from '../utils/permissions.js';
import { notify, notifyStaff } from '../services/notify.js';
import { emitAll } from '../services/realtime.js';

const r = Router();
r.use(auth);

// Catalog + availability
const esc = (q) => String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const present = (p) => ({ ...p.toJSON(), available: Math.max(0, p.stock - p.reserved), lowStock: p.stock - p.reserved <= p.reorderLevel });
const PART_FIELDS = ['sku', 'name', 'category', 'location', 'unitCost', 'reorderLevel', 'supplier', 'description', 'active'];

r.get('/', h(async (req, res) => {
  const filter = {};
  const staff = isStaffRole(req.user);
  if (!(staff && req.query.all === 'true')) filter.active = { $ne: false };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.q) {
    const rx = new RegExp(esc(req.query.q), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { supplier: rx }];
  }
  let parts = (await Part.find(filter).sort({ name: 1 }).limit(500)).map(present);
  if (req.query.low === 'true') parts = parts.filter((p) => p.lowStock);
  res.json(parts);
}));

const dupSku = (e) => (e.code === 11000 ? bad('A part with this SKU already exists') : e);

r.post('/', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const b = req.body;
  if (!b.sku?.trim() || !b.name?.trim()) throw bad('SKU and name are required');
  const stock = Math.max(0, Number(b.stock) || 0);
  let part;
  try {
    part = await Part.create({ ...Object.fromEntries(PART_FIELDS.filter((k) => b[k] !== undefined && k !== 'active').map((k) => [k, b[k]])), sku: b.sku.trim().toUpperCase(), name: b.name.trim(), stock });
  } catch (e) { throw dupSku(e); }
  if (stock) await StockMovement.create({ part: part._id, type: 'initial', delta: stock, balanceAfter: stock, note: 'Opening stock', by: req.user._id });
  res.status(201).json(present(part));
}));

// Stock is only changed through /adjust so every change is logged
r.patch('/:id', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const part = await Part.findById(req.params.id);
  if (!part) throw notFound('Part');
  PART_FIELDS.forEach((k) => req.body[k] !== undefined && part.set(k, k === 'sku' ? String(req.body[k]).trim().toUpperCase() : req.body[k]));
  try { await part.save(); } catch (e) { throw dupSku(e); }
  res.json(present(part));
}));

r.post('/:id/adjust', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const { type, note } = req.body;
  const qty = Number(req.body.qty);
  if (!['receive', 'issue', 'correction'].includes(type)) throw bad('Type must be receive, issue or correction');
  if (!Number.isFinite(qty) || qty < 0 || (type !== 'correction' && qty === 0)) throw bad('Enter a valid quantity');
  const part = await Part.findById(req.params.id);
  if (!part) throw notFound('Part');
  let updated;
  if (type === 'receive') updated = await Part.findByIdAndUpdate(part._id, { $inc: { stock: qty } }, { new: true });
  else if (type === 'issue') {
    // Conditional update so concurrent issues can never push stock below zero
    updated = await Part.findOneAndUpdate({ _id: part._id, stock: { $gte: qty } }, { $inc: { stock: -qty } }, { new: true });
    if (!updated) throw bad(`Only ${part.stock} in stock`);
  } else updated = await Part.findByIdAndUpdate(part._id, { stock: Math.round(qty) }, { new: true });
  const delta = updated.stock - part.stock;
  await StockMovement.create({ part: part._id, type, delta, balanceAfter: updated.stock, note: note || '', by: req.user._id });
  if (updated.stock - updated.reserved <= updated.reorderLevel && delta < 0) {
    await notifyStaff({ type: 'parts', title: 'Low stock', body: `${updated.name}: ${updated.stock} left (reorder at ${updated.reorderLevel})`, link: '/inventory' });
  }
  res.json(present(updated));
}));

r.get('/:id/movements', requireRole('supervisor', 'admin'), h(async (req, res) => {
  res.json(await StockMovement.find({ part: req.params.id }).populate('by', 'name').populate('job', 'orderNo').sort({ createdAt: -1 }).limit(100));
}));

r.get('/inventory/summary', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const parts = (await Part.find({ active: { $ne: false } })).map(present);
  res.json({
    items: parts.length,
    lowStock: parts.filter((p) => p.lowStock).length,
    outOfStock: parts.filter((p) => p.available === 0).length,
    stockValue: can.viewFinancials(req.user) ? Math.round(parts.reduce((s, p) => s + p.stock * p.unitCost, 0)) : null,
  });
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
      await StockMovement.create({ part: part._id, type: 'issue', delta: -pr.qty, balanceAfter: part.stock, note: 'Issued to repair order', job: pr.job, by: req.user._id });
      if (part.stock - part.reserved <= part.reorderLevel) await notifyStaff({ type: 'parts', title: 'Low stock', body: `${part.name}: ${part.stock} left (reorder at ${part.reorderLevel})`, link: '/inventory' });
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
