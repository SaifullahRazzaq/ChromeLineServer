import { Router } from 'express';
import { Attendance, LeaveRequest } from '../models/Attendance.js';
import Task from '../models/Task.js';
import Job from '../models/Job.js';
import User from '../models/User.js';
import { auth, requireRole } from '../middleware/auth.js';
import { h, bad, notFound, dayKey, startOfDay } from '../utils/http.js';
import { isStaffRole, can } from '../utils/permissions.js';
import { notify, notifyStaff } from '../services/notify.js';
import { getSettings, workedMinutes, breakMinutes, todayRecord } from '../services/shift.js';
import { stopTimer } from './jobs.js';

const r = Router();
r.use(auth);

const view = (a) => a && { ...a.toJSON(), workedMinutes: workedMinutes(a), breakMinutes: breakMinutes(a), onBreak: a.breaks.some((b) => !b.end) };

// Staff may inspect another user's records
const targetUser = (req) => (isStaffRole(req.user) && req.query.user ? req.query.user : req.user._id);

r.get('/today', h(async (req, res) => res.json(view(await todayRecord(req.user._id)) || null)));

r.post('/clock-in', h(async (req, res) => {
  if (await todayRecord(req.user._id)) throw bad('Already clocked in today');
  const a = await Attendance.create({ user: req.user._id, date: dayKey(), clockIn: new Date() });
  res.status(201).json(view(a));
}));

r.post('/clock-out', h(async (req, res) => {
  const a = await todayRecord(req.user._id);
  if (!a || a.clockOut) throw bad('You are not clocked in');
  const now = new Date();
  const open = a.breaks.find((b) => !b.end);
  if (open) open.end = now;
  a.clockOut = now;
  const { shiftMinutes } = await getSettings();
  a.overtimeMinutes = Math.max(0, workedMinutes(a, now) - shiftMinutes);
  await a.save();
  // Never leave a timer running after the shift ends
  const running = await Task.find({ runningSince: { $ne: null }, 'timeEntries.user': req.user._id });
  for (const t of running) if (t.timeEntries.some((e) => !e.end && String(e.user) === String(req.user._id))) await stopTimer(t, 'paused');
  res.json(view(a));
}));

r.post('/break/start', h(async (req, res) => {
  const a = await todayRecord(req.user._id);
  if (!a || a.clockOut) throw bad('You are not clocked in');
  if (a.breaks.some((b) => !b.end)) throw bad('Already on break');
  a.breaks.push({ start: new Date() });
  await a.save();
  const running = await Task.find({ runningSince: { $ne: null }, 'timeEntries.user': req.user._id });
  for (const t of running) if (t.timeEntries.some((e) => !e.end && String(e.user) === String(req.user._id))) await stopTimer(t, 'paused');
  res.json(view(a));
}));

r.post('/break/end', h(async (req, res) => {
  const a = await todayRecord(req.user._id);
  const open = a?.breaks.find((b) => !b.end);
  if (!open) throw bad('Not on break');
  open.end = new Date();
  await a.save();
  res.json(view(a));
}));

r.get('/history', h(async (req, res) => {
  const days = Math.min(90, Number(req.query.days) || 30);
  const from = dayKey(new Date(Date.now() - days * 864e5));
  const rows = await Attendance.find({ user: targetUser(req), date: { $gte: from } }).sort({ date: -1 });
  res.json(rows.map(view));
}));

// Daily timesheet: attendance plus job-wise labor drawn from server-written timer entries
async function laborFor(userId, from, to) {
  const tasks = await Task.find({ 'timeEntries.user': userId, 'timeEntries.start': { $gte: from, $lt: to } }).populate('job', 'orderNo vehicle');
  const now = Date.now();
  const byJob = {};
  for (const t of tasks) {
    for (const e of t.timeEntries) {
      if (String(e.user) !== String(userId) || e.start < from || e.start >= to) continue;
      const mins = ((e.end ? +e.end : now) - +e.start) / 60000;
      const key = String(t.job._id);
      byJob[key] ||= { job: t.job, minutes: 0, tasks: {} };
      byJob[key].minutes += mins;
      byJob[key].tasks[t.title] = (byJob[key].tasks[t.title] || 0) + mins;
    }
  }
  return Object.values(byJob).map((j) => ({
    job: j.job, minutes: Math.round(j.minutes), tasks: Object.entries(j.tasks).map(([title, m]) => ({ title, minutes: Math.round(m) })),
  }));
}

r.get('/timesheet', h(async (req, res) => {
  const date = req.query.date || dayKey();
  const from = new Date(`${date}T00:00:00`);
  const to = new Date(from.getTime() + 864e5);
  const uid = targetUser(req);
  const [a, labor] = await Promise.all([Attendance.findOne({ user: uid, date }), laborFor(uid, from, to)]);
  const logged = labor.reduce((s, j) => s + j.minutes, 0);
  const worked = a ? workedMinutes(a) : 0;
  res.json({ date, attendance: view(a) || null, labor, loggedMinutes: logged, workedMinutes: worked, unallocatedMinutes: Math.max(0, worked - logged) });
}));

r.get('/weekly', h(async (req, res) => {
  const uid = targetUser(req);
  const monday = startOfDay();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const days = [...Array(7)].map((_, i) => dayKey(new Date(monday.getTime() + i * 864e5)));
  const rows = await Attendance.find({ user: uid, date: { $in: days } });
  const out = days.map((d) => {
    const a = rows.find((x) => x.date === d);
    return { date: d, workedMinutes: a ? workedMinutes(a) : 0, overtimeMinutes: a?.overtimeMinutes || 0 };
  });
  const { shiftMinutes } = await getSettings();
  res.json({ days: out, totalMinutes: out.reduce((s, d) => s + d.workedMinutes, 0), overtimeMinutes: out.reduce((s, d) => s + d.overtimeMinutes, 0), targetMinutes: shiftMinutes * 5 });
}));

r.get('/overtime', h(async (req, res) => {
  const rows = await Attendance.find({ user: targetUser(req), overtimeMinutes: { $gt: 0 } }).sort({ date: -1 }).limit(60);
  res.json(rows.map(view));
}));

// Productivity: efficiency compares estimated against actual task time on completed tasks
r.get('/productivity', h(async (req, res) => {
  const uid = targetUser(req);
  const days = Math.min(90, Number(req.query.days) || 30);
  const since = new Date(Date.now() - days * 864e5);
  const tasks = await Task.find({ assignee: uid, status: 'completed', completedAt: { $gte: since } }).populate('job', 'orderNo');
  const jobs = await Job.find({ technician: uid, completedAt: { $gte: since } }).select('orderNo vehicle completedAt deadline qc');
  const est = tasks.reduce((s, t) => s + t.estimatedMinutes, 0);
  const act = tasks.reduce((s, t) => s + t.actualMinutes(), 0);
  const firstTimePass = jobs.filter((j) => j.qc.round <= 1 && j.qc.lastResult === 'passed').length;
  res.json({
    days, tasksCompleted: tasks.length, jobsCompleted: jobs.length, estimatedMinutes: est, actualMinutes: act,
    efficiency: act ? Math.round((est / act) * 100) : null,
    onTimeJobs: jobs.filter((j) => !j.deadline || j.completedAt <= j.deadline).length,
    firstTimePassRate: jobs.length ? Math.round((firstTimePass / jobs.length) * 100) : null,
    recentJobs: jobs.slice(0, 20),
  });
}));

r.get('/completed-jobs', h(async (req, res) => {
  res.json(await Job.find({ technician: targetUser(req), status: { $in: ['ready_for_qc', 'qc_passed', 'ready_for_delivery'] } })
    .select('orderNo vehicle status completedAt qc.round qc.lastResult').sort({ completedAt: -1 }).limit(50));
}));

// ---- leave ----
r.get('/leave', h(async (req, res) => {
  const filter = isStaffRole(req.user) && req.query.all === 'true' ? {} : { user: req.user._id };
  res.json(await LeaveRequest.find(filter).populate('user', 'name').sort({ createdAt: -1 }).limit(100));
}));

r.post('/leave', h(async (req, res) => {
  const { from, to, type, reason } = req.body;
  if (!from || !to || new Date(to) < new Date(from)) throw bad('Valid date range required');
  const lr = await LeaveRequest.create({ user: req.user._id, from, to, type, reason });
  await notifyStaff({ type: 'system', title: 'Leave request', body: `${req.user.name}: ${new Date(from).toDateString()} – ${new Date(to).toDateString()}`, link: '/attendance' });
  res.status(201).json(lr);
}));

r.post('/leave/:id/decide', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const lr = await LeaveRequest.findById(req.params.id);
  if (!lr) throw notFound('Leave request');
  if (lr.status !== 'pending') throw bad('Already decided');
  lr.status = req.body.approved ? 'approved' : 'rejected';
  lr.decidedBy = req.user._id;
  await lr.save();
  await notify(lr.user, { type: 'system', title: `Leave ${lr.status}`, body: `${new Date(lr.from).toDateString()} – ${new Date(lr.to).toDateString()}`, link: '/attendance' });
  res.json(lr);
}));

// Supervisor roster: who is on shift right now
r.get('/roster', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const techs = await User.find({ role: 'technician', active: true }).select('name specialty');
  const rows = await Attendance.find({ date: dayKey(), user: { $in: techs.map((t) => t._id) } });
  res.json(techs.map((t) => {
    const a = rows.find((x) => String(x.user) === String(t._id));
    return { user: t, clockedIn: !!a && !a.clockOut, onBreak: !!a?.breaks.some((b) => !b.end), workedMinutes: a ? workedMinutes(a) : 0 };
  }));
}));

export default r;
