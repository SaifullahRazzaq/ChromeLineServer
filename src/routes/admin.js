import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Job from '../models/Job.js';
import Task from '../models/Task.js';
import { Attendance } from '../models/Attendance.js';
import { Setting } from '../models/Comms.js';
import { auth, requireRole, requireCan } from '../middleware/auth.js';
import { h, bad, notFound, forbidden, HttpError } from '../utils/http.js';
import { can } from '../utils/permissions.js';
import { getSettings, DEFAULT_SETTINGS, workedMinutes } from '../services/shift.js';

const r = Router();
r.use(auth);

// Technician management. Admins manage everyone; supervisors manage technician accounts only (the "limited" row
// of the permission matrix); a technician explicitly granted manageTechnicians gets the same limited access.
const canManageUsers = (req, _res, next) =>
  req.user.role === 'admin' || req.user.role === 'supervisor' || can.manageTechnicians(req.user) ? next() : next(forbidden('Not allowed to manage users'));

const PROFILE = ['name', 'specialty', 'phone', 'address', 'joinedAt', 'skills', 'emergencyContact'];

async function nextEmployeeId() {
  const last = await User.find({ employeeId: /^TECH-\d+$/ }).select('employeeId').lean();
  const max = last.reduce((m, u) => Math.max(m, Number(u.employeeId.slice(5))), 0);
  return `TECH-${String(max + 1).padStart(3, '0')}`;
}

const cleanSkills = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean).slice(0, 20);

r.get('/users', requireRole('supervisor', 'admin'), h(async (req, res) => {
  const filter = req.query.role ? { role: req.query.role } : {};
  if (req.user.role === 'supervisor') filter.role = 'technician';
  if (req.query.active === 'true') filter.active = true;
  res.json(await User.find(filter).sort({ name: 1 }));
}));

r.post('/users', canManageUsers, h(async (req, res) => {
  const b = req.body;
  const email = String(b.email || '').trim().toLowerCase();
  if (!b.name?.trim()) throw bad('Name is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('A valid email is required');
  if (!b.password || b.password.length < 8) throw bad('Password must be at least 8 characters');
  const isAdmin = req.user.role === 'admin';
  const role = isAdmin ? b.role || 'technician' : 'technician';
  if (!['technician', 'supervisor', 'admin'].includes(role)) throw bad('Invalid role');
  if (await User.exists({ email })) throw new HttpError(409, 'A user with this email already exists');
  const employeeId = b.employeeId?.trim() || (role === 'technician' ? await nextEmployeeId() : undefined);
  if (employeeId && (await User.exists({ employeeId }))) throw new HttpError(409, 'Employee ID already in use');
  const user = await User.create({
    name: b.name.trim(), email, role, employeeId,
    specialty: b.specialty, phone: b.phone, address: b.address, joinedAt: b.joinedAt || new Date(),
    skills: cleanSkills(b.skills), emergencyContact: b.emergencyContact,
    passwordHash: await bcrypt.hash(b.password, 10),
    permissions: isAdmin && b.permissions ? b.permissions : undefined,
  });
  res.status(201).json(user);
}));

r.patch('/users/:id', canManageUsers, h(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User');
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && user.role !== 'technician') throw forbidden('Only admins can edit staff accounts');
  PROFILE.forEach((k) => req.body[k] !== undefined && user.set(k, k === 'skills' ? cleanSkills(req.body[k]) : req.body[k]));
  if (req.body.active !== undefined) {
    if (String(user._id) === String(req.user._id) && req.body.active === false) throw bad('You cannot deactivate yourself');
    user.active = !!req.body.active;
  }
  if (req.body.email && req.body.email.toLowerCase() !== user.email) {
    if (!isAdmin) throw forbidden('Only admins can change an email address');
    if (await User.exists({ email: req.body.email.toLowerCase(), _id: { $ne: user._id } })) throw new HttpError(409, 'A user with this email already exists');
    user.email = req.body.email.toLowerCase();
  }
  if (req.body.employeeId !== undefined && req.body.employeeId !== user.employeeId) {
    if (req.body.employeeId && (await User.exists({ employeeId: req.body.employeeId, _id: { $ne: user._id } }))) throw new HttpError(409, 'Employee ID already in use');
    user.employeeId = req.body.employeeId || undefined;
  }
  if (isAdmin) {
    if (req.body.role && String(user._id) === String(req.user._id) && req.body.role !== user.role) throw bad('You cannot change your own role');
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
