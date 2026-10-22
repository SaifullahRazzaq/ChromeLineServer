import { Router } from 'express';
import Job, { REPAIR_TYPES } from '../models/Job.js';
import Task from '../models/Task.js';
import { PartRequest } from '../models/Part.js';
import User from '../models/User.js';
import { auth, requireRole } from '../middleware/auth.js';
import { h, bad, notFound, forbidden } from '../utils/http.js';
import { can, isStaffRole } from '../utils/permissions.js';
import { notify, notifyStaff } from '../services/notify.js';
import { emitAll } from '../services/realtime.js';
import { upload, publish } from '../services/storage.js';
import { INSPECTION_CHECKLIST, workflowFor, FINAL_CHECKLIST, QC_SELF_CHECKLIST } from '../services/checklists.js';

const r = Router();
r.use(auth);

const POPULATE = [
  { path: 'technician', select: 'name email specialty' },
  { path: 'supervisor', select: 'name email' },
];

export async function loadJob(req, { populate = true } = {}) {
  let q = Job.findById(req.params.id);
  if (populate) POPULATE.forEach((p) => (q = q.populate(p)));
  const job = await q;
  if (!job) throw notFound('Job');
  const techId = job.technician?._id ?? job.technician;
  if (!isStaffRole(req.user) && String(techId) !== String(req.user._id)) throw forbidden('Job not assigned to you');
  return job;
}

export const log = (job, req, type, text) => job.history.push({ type, text, by: req.user._id });

const broadcast = (job, event = 'job:updated') =>
  emitAll(event, { id: job._id, status: job.status, progress: job.progress, orderNo: job.orderNo });

const assertStatus = (job, allowed, action) => {
  if (!allowed.includes(job.status)) throw bad(`Cannot ${action} while job is "${job.status}"`);
};

const ownerOnly = (job, req) => {
  const techId = String(job.technician?._id ?? job.technician);
  if (techId !== String(req.user._id) && !isStaffRole(req.user)) throw forbidden('Only the assigned technician can do this');
};

// ---------- list / create / read ----------
r.get('/', h(async (req, res) => {
  const { status, priority, scope, q, overdue } = req.query;
  const filter = {};
  if (!isStaffRole(req.user) || scope === 'mine') filter.technician = req.user._id;
  if (status) filter.status = { $in: String(status).split(',') };
  if (priority) filter.priority = priority;
  if (overdue === 'true') {
    filter.deadline = { $lt: new Date() };
    filter.status = { $nin: ['qc_passed', 'ready_for_delivery'] };
  }
  if (q) {
    const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ orderNo: rx }, { 'vehicle.make': rx }, { 'vehicle.model': rx }, { 'vehicle.vin': rx }, { 'vehicle.plate': rx }, { 'customer.name': rx }];
  }
  const jobs = await Job.find(filter)
    .select('-history -photos -internalNotes -comments -inspection -workflows -finalChecklist')
    .populate(POPULATE)
    .sort({ deadline: 1, createdAt: -1 })
    .limit(200);
  res.json(jobs);
}));

r.post('/', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const b = req.body;
  if (!b.vehicle?.make || !b.customer?.name) throw bad('Customer name and vehicle make are required');
  if (!b.vehicle?.plate?.trim()) throw bad('Number plate is required (customers use it to track their repair)');
  const count = await Job.countDocuments();
  const types = (b.repairTypes || []).filter((t) => REPAIR_TYPES.includes(t));
  const job = await Job.create({
    orderNo: b.orderNo || `RO-${String(1001 + count)}`,
    customer: b.customer,
    vehicle: b.vehicle,
    damageDescription: b.damageDescription,
    estimate: { amount: b.estimate?.amount || 0, customerApproved: !!b.estimate?.customerApproved },
    insurance: b.insurance,
    instructions: b.instructions,
    priority: b.priority,
    deadline: b.deadline,
    repairTypes: types,
    technician: b.technician || undefined,
    supervisor: req.user._id,
    inspection: { checklist: INSPECTION_CHECKLIST() },
    workflows: workflowFor(types),
    finalChecklist: FINAL_CHECKLIST(),
    qc: { selfChecklist: QC_SELF_CHECKLIST() },
    history: [{ type: 'created', text: 'Repair order created', by: req.user._id }],
  });
  if (job.technician) {
    await notify(job.technician, { type: 'assignment', title: 'New job assigned', body: `${job.orderNo} · ${job.vehicle.make} ${job.vehicle.model}`, link: `/jobs/${job._id}` });
  }
  broadcast(job, 'job:created');
  res.status(201).json(job);
}));

r.get('/:id', h(async (req, res) => {
  const job = await loadJob(req);
  const [tasks, partRequests, vehicleHistory] = await Promise.all([
    Task.find({ job: job._id }).populate('assignee', 'name').sort({ createdAt: 1 }),
    PartRequest.find({ job: job._id }).populate('requestedBy', 'name').sort({ createdAt: -1 }),
    job.vehicle?.vin
      ? Job.find({ 'vehicle.vin': job.vehicle.vin, _id: { $ne: job._id } }).select('orderNo status damageDescription createdAt completedAt').sort({ createdAt: -1 }).limit(10)
      : [],
  ]);
  const populated = await job.populate([
    { path: 'comments.by', select: 'name role' },
    { path: 'internalNotes.by', select: 'name role' },
    { path: 'history.by', select: 'name' },
    { path: 'photos.uploadedBy', select: 'name' },
  ]);
  res.json({ ...populated.toJSON(), tasks, partRequests, vehicleHistory });
}));

r.patch('/:id', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  const allowed = ['customer', 'vehicle', 'damageDescription', 'instructions', 'priority', 'deadline', 'insurance', 'requiredParts'];
  const before = { ins: job.insurance?.status, est: job.estimate?.customerApproved };
  allowed.forEach((k) => req.body[k] !== undefined && job.set(k, req.body[k]));
  if (req.body.estimate) {
    job.estimate.amount = req.body.estimate.amount ?? job.estimate.amount;
    if (req.body.estimate.customerApproved !== undefined) {
      job.estimate.customerApproved = req.body.estimate.customerApproved;
      job.estimate.approvedAt = req.body.estimate.customerApproved ? new Date() : undefined;
    }
  }
  log(job, req, 'updated', 'Order details updated');
  await job.save();
  if (job.technician && (before.ins !== job.insurance?.status || before.est !== job.estimate.customerApproved)) {
    await notify(job.technician, { type: 'approval', title: 'Approval status changed', body: `${job.orderNo}: insurance ${job.insurance?.status || 'none'}, estimate ${job.estimate.customerApproved ? 'approved' : 'not approved'}`, link: `/jobs/${job._id}` });
  }
  broadcast(job);
  res.json(job);
}));

r.post('/:id/assign', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  const tech = await User.findOne({ _id: req.body.technician, active: true });
  if (!tech) throw bad('Technician not found');
  job.technician = tech._id;
  log(job, req, 'assigned', `Assigned to ${tech.name}`);
  await job.save();
  await Task.updateMany({ job: job._id, status: { $ne: 'completed' } }, { assignee: tech._id });
  await notify(tech._id, { type: 'assignment', title: 'New job assigned', body: `${job.orderNo} · ${job.vehicle.make} ${job.vehicle.model}`, link: `/jobs/${job._id}` });
  broadcast(job);
  res.json(job);
}));

// ---------- Phase 3: workflow ----------
r.post('/:id/accept', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  assertStatus(job, ['assigned'], 'accept');
  job.status = 'accepted';
  job.acceptedAt = new Date();
  log(job, req, 'accepted', 'Job accepted');
  await job.save();
  await notifyStaff({ type: 'system', title: 'Job accepted', body: `${req.user.name} accepted ${job.orderNo}`, link: `/jobs/${job._id}` });
  broadcast(job);
  res.json(job);
}));

r.post('/:id/start', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  assertStatus(job, ['accepted', 'awaiting_parts', 'rework'], 'start repair');
  if (!job.estimate.customerApproved && !isStaffRole(req.user)) throw bad('Estimate has not been approved by the customer');
  job.status = 'in_progress';
  job.startedAt ||= new Date();
  log(job, req, 'started', job.qc.lastResult === 'failed' ? 'Rework started' : 'Repair started');
  await job.save();
  broadcast(job);
  res.json(job);
}));

r.post('/:id/pause', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  assertStatus(job, ['in_progress'], 'pause');
  if (!req.body.reason) throw bad('A reason is required to pause');
  job.status = req.body.awaitingParts ? 'awaiting_parts' : 'paused';
  job.pauses.push({ start: new Date(), reason: req.body.reason });
  log(job, req, 'paused', `Paused: ${req.body.reason}`);
  // Running task timers stop with the job so labor is never over-counted
  const running = await Task.find({ job: job._id, runningSince: { $ne: null } });
  for (const t of running) await stopTimer(t, 'paused');
  await job.save();
  broadcast(job);
  res.json(job);
}));

r.post('/:id/resume', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  assertStatus(job, ['paused'], 'resume');
  const open = job.pauses.find((p) => !p.end);
  if (open) open.end = new Date();
  job.status = 'in_progress';
  log(job, req, 'resumed', 'Repair resumed');
  await job.save();
  broadcast(job);
  res.json(job);
}));

export async function stopTimer(task, nextStatus) {
  if (task.runningSince) {
    const open = task.timeEntries.find((e) => !e.end);
    if (open) open.end = new Date();
    task.runningSince = undefined;
  }
  if (nextStatus) task.status = nextStatus;
  await task.save();
}

r.patch('/:id/progress', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  assertStatus(job, ['in_progress', 'paused', 'rework'], 'update progress');
  const pct = Number(req.body.progress);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw bad('Progress must be 0-100');
  job.progress = Math.round(pct);
  log(job, req, 'progress', `Progress set to ${job.progress}%${req.body.note ? ` — ${req.body.note}` : ''}`);
  await job.save();
  broadcast(job);
  res.json(job);
}));

r.post('/:id/request-inspection', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  job.inspectionRequests.push({ note: req.body.note || '', by: req.user._id });
  log(job, req, 'inspection_requested', 'Supervisor inspection requested');
  await job.save();
  await notifyStaff({ type: 'qc', title: 'Inspection requested', body: `${req.user.name} on ${job.orderNo}: ${req.body.note || 'no note'}`, link: `/jobs/${job._id}` });
  res.json(job);
}));

r.post('/:id/inspection-requests/:rid/resolve', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  const reqItem = job.inspectionRequests.id(req.params.rid);
  if (!reqItem) throw notFound('Request');
  reqItem.resolved = true;
  await job.save();
  await notify(job.technician, { type: 'qc', title: 'Inspection completed', body: job.orderNo, link: `/jobs/${job._id}` });
  res.json(job);
}));

r.post('/:id/delay', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  if (!req.body.reason) throw bad('Reason is required');
  job.delays.push({ reason: req.body.reason, newDeadline: req.body.newDeadline, by: req.user._id });
  log(job, req, 'delay', `Delay reported: ${req.body.reason}`);
  await job.save();
  await notifyStaff({ type: 'delay', title: 'Delay reported', body: `${job.orderNo}: ${req.body.reason}`, link: `/jobs/${job._id}` });
  res.json(job);
}));

r.post('/:id/additional-damage', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  if (!req.body.description) throw bad('Description is required');
  job.additionalDamage.push({ description: req.body.description, severity: req.body.severity, photos: req.body.photos || [], by: req.user._id });
  log(job, req, 'additional_damage', `Additional damage: ${req.body.description}`);
  await job.save();
  await notifyStaff({ type: 'delay', title: 'Additional damage found', body: `${job.orderNo}: ${req.body.description}`, link: `/jobs/${job._id}` });
  res.json(job);
}));

r.post('/:id/supplement', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  const amount = Number(req.body.amount);
  if (!req.body.reason || !Number.isFinite(amount) || amount <= 0) throw bad('Reason and a positive amount are required');
  job.estimate.supplements.push({ amount, reason: req.body.reason, requestedBy: req.user._id });
  log(job, req, 'supplement', `Estimate supplement requested: ${req.body.reason}`);
  await job.save();
  await notifyStaff({ type: 'approval', title: 'Estimate supplement requested', body: `${job.orderNo}: ${req.body.reason}`, link: `/jobs/${job._id}` });
  res.json(job);
}));

r.post('/:id/supplement/:sid/decide', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  const s = job.estimate.supplements.id(req.params.sid);
  if (!s) throw notFound('Supplement');
  s.status = req.body.approved ? 'approved' : 'rejected';
  if (req.body.approved) job.estimate.amount += s.amount;
  log(job, req, 'supplement_decision', `Supplement ${s.status}`);
  await job.save();
  await notify(job.technician, { type: 'approval', title: `Supplement ${s.status}`, body: `${job.orderNo}: ${s.reason}`, link: `/jobs/${job._id}` });
  res.json(job);
}));

// Technician finishes assigned work; still needs QC submission afterwards
r.post('/:id/complete-work', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  assertStatus(job, ['in_progress', 'rework'], 'complete work');
  const open = await Task.countDocuments({ job: job._id, status: { $nin: ['completed'] } });
  if (open) throw bad(`${open} task(s) are still open`);
  const missing = job.finalChecklist.filter((c) => !c.done).length;
  if (missing) throw bad(`Final repair checklist has ${missing} unchecked item(s)`);
  job.progress = 100;
  job.completedAt = new Date();
  log(job, req, 'work_completed', 'Assigned work completed');
  await job.save();
  broadcast(job);
  res.json(job);
}));

// ---------- notes / comments ----------
r.post('/:id/notes', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  if (!req.body.text?.trim()) throw bad('Text required');
  job.internalNotes.push({ text: req.body.text.trim(), by: req.user._id });
  await job.save();
  res.status(201).json(job.internalNotes.at(-1));
}));

r.post('/:id/comments', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  if (!req.body.text?.trim()) throw bad('Text required');
  job.comments.push({ text: req.body.text.trim(), by: req.user._id });
  await job.save();
  const c = job.comments.at(-1);
  const targets = isStaffRole(req.user) ? [job.technician] : [job.supervisor];
  await notify(targets.filter((t) => String(t) !== String(req.user._id)), { type: 'comment', title: `Comment on ${job.orderNo}`, body: `${req.user.name}: ${c.text.slice(0, 120)}`, link: `/jobs/${job._id}` });
  emitAll('job:comment', { jobId: job._id, comment: { ...c.toJSON(), by: { _id: req.user._id, name: req.user.name, role: req.user.role } } });
  res.status(201).json({ ...c.toJSON(), by: { _id: req.user._id, name: req.user.name, role: req.user.role } });
}));

// ---------- checklists (Phase 4/6/8) ----------
const findList = (job, list, type) => {
  if (list === 'inspection') return job.inspection.checklist;
  if (list === 'final') return job.finalChecklist;
  if (list === 'qc') return job.qc.selfChecklist;
  if (list === 'workflow') return job.workflows.find((w) => w.type === type)?.steps;
  return null;
};

r.patch('/:id/checklist/:list/:key', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  const items = findList(job, req.params.list, req.query.type);
  const item = items?.find((i) => i.key === req.params.key);
  if (!item) throw notFound('Checklist item');
  if (req.body.done !== undefined) {
    item.done = !!req.body.done;
    item.by = req.user._id;
    item.at = new Date();
  }
  if (req.body.note !== undefined) item.note = String(req.body.note).slice(0, 500);
  await job.save();
  res.json(item);
}));

// ---------- inspection ----------
r.put('/:id/inspection', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  const b = req.body;
  if (b.notes !== undefined) job.inspection.notes = b.notes;
  if (Array.isArray(b.damageMarkers)) {
    job.inspection.damageMarkers = b.damageMarkers.map((m) => ({
      view: m.view, x: Math.min(100, Math.max(0, +m.x)), y: Math.min(100, Math.max(0, +m.y)), severity: m.severity, note: m.note, existing: !!m.existing,
    }));
  }
  await job.save();
  res.json(job.inspection);
}));

r.post('/:id/inspection/equipment-issue', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  if (!req.body.description) throw bad('Description required');
  job.inspection.equipmentIssues.push({ description: req.body.description, by: req.user._id });
  await job.save();
  await notifyStaff({ type: 'delay', title: 'Equipment issue', body: `${job.orderNo}: ${req.body.description}`, link: `/jobs/${job._id}` });
  res.status(201).json(job.inspection.equipmentIssues.at(-1));
}));

r.post('/:id/inspection/complete', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  const pending = job.inspection.checklist.filter((c) => !c.done).length;
  if (pending) throw bad(`${pending} mandatory checklist item(s) are incomplete`);
  if (!job.photos.some((p) => p.kind === 'before')) throw bad('At least one before photo is mandatory');
  if (!job.inspection.notes?.trim()) throw bad('Inspection notes are mandatory');
  job.inspection.completed = true;
  job.inspection.completedAt = new Date();
  log(job, req, 'inspection', 'Check-in inspection completed');
  await job.save();
  res.json(job.inspection);
}));

// ---------- photos ----------
r.post('/:id/photos', upload.array('photos', 10), h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  const kind = req.body.kind;
  if (!['before', 'damage', 'progress', 'after', 'inspection', 'qc'].includes(kind)) throw bad('Invalid photo kind');
  if (!req.files?.length) throw bad('No valid image files received (png, jpg, webp, gif, heic, pdf up to 15MB)');
  const urls = await Promise.all(req.files.map(publish));
  urls.forEach((url) => job.photos.push({ kind, url, caption: req.body.caption || '', uploadedBy: req.user._id }));
  log(job, req, 'photos', `${urls.length} ${kind} photo(s) uploaded`);
  await job.save();
  res.status(201).json(job.photos.slice(-urls.length));
}));

r.patch('/:id/photos/:pid', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  const p = job.photos.id(req.params.pid);
  if (!p) throw notFound('Photo');
  if (req.body.caption !== undefined) p.caption = req.body.caption;
  if (Array.isArray(req.body.annotations)) p.annotations = req.body.annotations.map((a) => ({ x: +a.x, y: +a.y, text: String(a.text || '') }));
  await job.save();
  res.json(p);
}));

r.delete('/:id/photos/:pid', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  const p = job.photos.id(req.params.pid);
  if (!p) throw notFound('Photo');
  if (String(p.uploadedBy) !== String(req.user._id) && !isStaffRole(req.user)) throw forbidden();
  p.deleteOne();
  await job.save();
  res.status(204).end();
}));

// ---------- required parts / parts used (Phase 7) ----------
r.post('/:id/parts-used', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  ownerOnly(job, req);
  const qty = Number(req.body.qty) || 1;
  if (!req.body.name && !req.body.part) throw bad('Part name or id required');
  const { Part } = await import('../models/Part.js');
  let name = req.body.name;
  if (req.body.part) {
    const part = await Part.findById(req.body.part);
    if (!part) throw notFound('Part');
    name = part.name;
  }
  job.partsUsed.push({ part: req.body.part, name, qty, by: req.user._id });
  log(job, req, 'parts_used', `${qty} × ${name} used`);
  await job.save();
  res.status(201).json(job.partsUsed.at(-1));
}));

export default r;
