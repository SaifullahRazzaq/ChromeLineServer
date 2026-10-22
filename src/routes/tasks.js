import { Router } from 'express';
import Task from '../models/Task.js';
import Job from '../models/Job.js';
import User from '../models/User.js';
import { auth, requireRole } from '../middleware/auth.js';
import { h, bad, notFound, forbidden } from '../utils/http.js';
import { isStaffRole } from '../utils/permissions.js';
import { notify, notifyStaff } from '../services/notify.js';
import { emitAll } from '../services/realtime.js';
import { requireActiveShift } from '../services/shift.js';
import { stopTimer } from './jobs.js';

const r = Router();
r.use(auth);

async function loadTask(req) {
  const task = await Task.findById(req.params.id);
  if (!task) throw notFound('Task');
  if (!isStaffRole(req.user) && String(task.assignee) !== String(req.user._id)) throw forbidden('Task not assigned to you');
  return task;
}

async function syncJobProgress(jobId) {
  const tasks = await Task.find({ job: jobId });
  if (!tasks.length) return;
  const job = await Job.findById(jobId);
  if (!job || !['in_progress', 'paused', 'rework'].includes(job.status)) return;
  job.progress = Math.round(tasks.reduce((s, t) => s + t.completionPct, 0) / tasks.length);
  await job.save();
  emitAll('job:updated', { id: job._id, status: job.status, progress: job.progress, orderNo: job.orderNo });
}

const populate = (q) => q.populate('assignee', 'name').populate('job', 'orderNo vehicle status deadline').populate('dependencies', 'title status');

r.get('/', h(async (req, res) => {
  const filter = {};
  if (!isStaffRole(req.user) || req.query.mine === 'true') filter.assignee = req.user._id;
  if (req.query.job) filter.job = req.query.job;
  if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
  res.json(await populate(Task.find(filter)).sort({ createdAt: 1 }).limit(300));
}));

r.post('/', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const b = req.body;
  const job = await Job.findById(b.job);
  if (!job) throw notFound('Job');
  if (!b.title?.trim()) throw bad('Title required');
  const task = await Task.create({
    job: job._id, title: b.title.trim(), instructions: b.instructions, repairType: b.repairType, priority: b.priority || job.priority,
    assignee: b.assignee || job.technician, dependencies: b.dependencies || [], estimatedMinutes: b.estimatedMinutes || 60, dueAt: b.dueAt || job.deadline,
  });
  if (task.assignee) await notify(task.assignee, { type: 'assignment', title: 'New task assigned', body: `${job.orderNo}: ${task.title}`, link: `/jobs/${job._id}` });
  emitAll('task:updated', { id: task._id, job: job._id });
  res.status(201).json(task);
}));

r.get('/:id', h(async (req, res) => {
  await loadTask(req);
  res.json(await populate(Task.findById(req.params.id)));
}));

r.patch('/:id', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) throw notFound('Task');
  ['title', 'instructions', 'priority', 'estimatedMinutes', 'dependencies', 'dueAt'].forEach((k) => req.body[k] !== undefined && task.set(k, req.body[k]));
  await task.save();
  res.json(task);
}));

r.post('/:id/start', h(async (req, res) => {
  const task = await loadTask(req);
  if (!['todo', 'paused', 'rework', 'in_progress'].includes(task.status)) throw bad(`Cannot start a ${task.status} task`);
  if (task.status === 'in_progress' && task.runningSince) throw bad('Timer is already running');
  const job = await Job.findById(task.job);
  if (!['in_progress', 'rework'].includes(job.status)) throw bad('Start the repair job before starting task timers');
  const pending = await Task.countDocuments({ _id: { $in: task.dependencies }, status: { $ne: 'completed' } });
  if (pending) throw bad(`Blocked by ${pending} unfinished dependency task(s)`);
  await requireActiveShift(req.user._id);
  // One live timer per technician: stop whatever else is running
  const others = await Task.find({ runningSince: { $ne: null }, 'timeEntries.user': req.user._id, _id: { $ne: task._id } });
  for (const o of others) if (o.timeEntries.some((e) => !e.end && String(e.user) === String(req.user._id))) await stopTimer(o, 'paused');
  const now = new Date();
  task.timeEntries.push({ start: now, user: req.user._id });
  task.runningSince = now;
  task.status = 'in_progress';
  await task.save();
  emitAll('task:updated', { id: task._id, job: task.job });
  res.json(task);
}));

r.post('/:id/stop', h(async (req, res) => {
  const task = await loadTask(req);
  if (!task.runningSince) throw bad('Timer is not running');
  await stopTimer(task, 'paused');
  emitAll('task:updated', { id: task._id, job: task.job });
  res.json(task);
}));

r.patch('/:id/progress', h(async (req, res) => {
  const task = await loadTask(req);
  const pct = Number(req.body.completionPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw bad('Completion must be 0-100');
  if (pct === 100) throw bad('Use the complete action to finish a task');
  task.completionPct = Math.round(pct);
  await task.save();
  await syncJobProgress(task.job);
  res.json(task);
}));

r.post('/:id/complete', h(async (req, res) => {
  const task = await loadTask(req);
  if (task.status === 'completed') throw bad('Already completed');
  if (task.status === 'blocked') throw bad('Resolve the blocker first');
  const pending = await Task.countDocuments({ _id: { $in: task.dependencies }, status: { $ne: 'completed' } });
  if (pending) throw bad('Dependencies are not finished');
  await stopTimer(task);
  task.status = 'completed';
  task.completionPct = 100;
  task.completedAt = new Date();
  await task.save();
  await syncJobProgress(task.job);
  emitAll('task:updated', { id: task._id, job: task.job });
  res.json(task);
}));

r.post('/:id/block', h(async (req, res) => {
  const task = await loadTask(req);
  if (!req.body.reason) throw bad('Reason required');
  await stopTimer(task);
  task.status = 'blocked';
  task.blocked = { reason: req.body.reason, at: new Date(), by: req.user._id };
  await task.save();
  const job = await Job.findById(task.job);
  await notifyStaff({ type: 'delay', title: 'Task blocked', body: `${job.orderNo} · ${task.title}: ${req.body.reason}`, link: `/jobs/${job._id}` });
  emitAll('task:updated', { id: task._id, job: task.job });
  res.json(task);
}));

r.post('/:id/unblock', h(async (req, res) => {
  const task = await loadTask(req);
  if (task.status !== 'blocked') throw bad('Task is not blocked');
  task.status = 'paused';
  task.blocked = undefined;
  await task.save();
  res.json(task);
}));

r.post('/:id/reassign-request', h(async (req, res) => {
  const task = await loadTask(req);
  if (!req.body.reason) throw bad('Reason required');
  task.reassignRequest = { reason: req.body.reason, requestedBy: req.user._id, at: new Date(), status: 'pending' };
  await task.save();
  const job = await Job.findById(task.job);
  await notifyStaff({ type: 'system', title: 'Reassignment requested', body: `${req.user.name} · ${job.orderNo} · ${task.title}`, link: `/jobs/${job._id}` });
  res.json(task);
}));

r.post('/:id/reassign', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) throw notFound('Task');
  const decideOnly = req.body.approve === false;
  if (!decideOnly) {
    const tech = await User.findOne({ _id: req.body.assignee, active: true });
    if (!tech) throw bad('Technician not found');
    await stopTimer(task, task.status === 'in_progress' ? 'paused' : undefined);
    task.assignee = tech._id;
    await notify(tech._id, { type: 'assignment', title: 'Task reassigned to you', body: task.title, link: `/jobs/${task.job}` });
  }
  if (task.reassignRequest?.status === 'pending') {
    task.reassignRequest.status = decideOnly ? 'rejected' : 'approved';
    await notify(task.reassignRequest.requestedBy, { type: 'system', title: `Reassignment ${task.reassignRequest.status}`, body: task.title, link: `/jobs/${task.job}` });
  }
  await task.save();
  res.json(task);
}));

r.post('/:id/review', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) throw notFound('Task');
  task.review = { by: req.user._id, approved: !!req.body.approved, note: req.body.note || '', at: new Date() };
  if (!req.body.approved) {
    task.status = 'rework';
    task.completionPct = 50;
    task.completedAt = undefined;
  }
  await task.save();
  await notify(task.assignee, { type: 'qc', title: req.body.approved ? 'Task approved' : 'Task sent back for rework', body: `${task.title}${req.body.note ? ` — ${req.body.note}` : ''}`, link: `/jobs/${task.job}` });
  await syncJobProgress(task.job);
  res.json(task);
}));

export default r;
