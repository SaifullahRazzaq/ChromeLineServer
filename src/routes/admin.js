import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Job from '../models/Job.js';
import Task from '../models/Task.js';
import { Attendance } from '../models/Attendance.js';
import { Setting } from '../models/Comms.js';
import { auth, requireRole, requireCan } from '../middleware/auth.js';
import { h, bad, notFound, forbidden } from '../utils/http.js';
import { can } from '../utils/permissions.js';
import { getSettings, DEFAULT_SETTINGS, workedMinutes } from '../services/shift.js';

const r = Router();
r.use(auth);

// Technician directory: supervisors get a read/limited view, admins manage
r.get('/users', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const filter = req.query.role ? { role: req.query.role } : {};
  if (req.user.role === 'supervisor') filter.role = 'technician'; // limited management
  res.json(await User.find(filter).sort({ name: 1 }));
}));

r.post('/users', requireCan('manageTechnicians'), h(async (req, res) => {
  const b = req.body;
  if (!b.name || !b.email || !b.password || b.password.length < 8) throw bad('Name, email and a password of 8+ characters are required');
  if (b.role && b.role !== 'technician' && req.user.role !== 'admin') throw forbidden('Only admins can create staff accounts');
  const user = await User.create({
    name: b.name, email: b.email, role: req.user.role === 'admin' ? b.role || 'technician' : 'technician',
    specialty: b.specialty, phone: b.phone, passwordHash: await bcrypt.hash(b.password, 10),
    permissions: req.user.role === 'admin' ? b.permissions : undefined,
  });
  res.status(201).json(user);
}));

r.patch('/users/:id', requireCan('manageTechnicians'), h(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User');
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && user.role !== 'technician') throw forbidden();
  ['name', 'specialty', 'phone', 'active'].forEach((k) => req.body[k] !== undefined && user.set(k, req.body[k]));
  if (isAdmin) {
    if (req.body.role) user.role = req.body.role;
    if (req.body.permissions) {
      for (const k of ['approveQC', 'viewFinancials', 'manageTechnicians']) {
        if (req.body.permissions[k] !== undefined) user.set(`permissions.${k}`, !!req.body.permissions[k]);
      }
    }
  }
  if (req.body.password) {
    if (req.body.password.length < 8) throw bad('Password must be 8+ characters');
    user.passwordHash = await bcrypt.hash(req.body.password, 10);
  }
  if (String(user._id) === String(req.user._id) && req.body.active === false) throw bad('You cannot deactivate yourself');
  await user.save();
  res.json(user);
}));

r.get('/settings', h(async (_req, res) => res.json(await getSettings())));

r.put('/settings', requireCan('manageSettings'), h(async (req, res) => {
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (req.body[k] !== undefined) await Setting.updateOne({ key: k }, { value: req.body[k] }, { upsert: true });
  }
  res.json(await getSettings());
}));

// Financial reporting: admin, or anyone explicitly granted
r.get('/reports/financial', requireCan('viewFinancials'), h(async (_req, res) => {
  const jobs = await Job.find().select('orderNo status estimate partsUsed insurance createdAt');
  const bySt = {};
  let total = 0, approved = 0, supplements = 0;
  for (const j of jobs) {
    total += j.estimate.amount;
    if (j.estimate.customerApproved) approved += j.estimate.amount;
    supplements += j.estimate.supplements.filter((s) => s.status === 'approved').reduce((s, x) => s + x.amount, 0);
    bySt[j.status] = (bySt[j.status] || 0) + j.estimate.amount;
  }
  res.json({ jobCount: jobs.length, totalEstimates: total, approvedEstimates: approved, approvedSupplements: supplements, byStatus: bySt });
}));

// Supervisor/admin team overview
r.get('/reports/team', requireRole('supervisor', 'admin'), h(async (_req, res) => {
  const techs = await User.find({ role: 'technician', active: true }).select('name specialty');
  const rows = await Promise.all(techs.map(async (t) => {
    const [active, done, overdue] = await Promise.all([
      Job.countDocuments({ technician: t._id, status: { $in: ['accepted', 'in_progress', 'paused', 'rework', 'awaiting_parts'] } }),
      Job.countDocuments({ technician: t._id, status: { $in: ['qc_passed', 'ready_for_delivery'] } }),
      Job.countDocuments({ technician: t._id, deadline: { $lt: new Date() }, status: { $nin: ['qc_passed', 'ready_for_delivery'] } }),
    ]);
    return { technician: t, activeJobs: active, completedJobs: done, overdueJobs: overdue };
  }));
  res.json(rows);
}));

export default r;
