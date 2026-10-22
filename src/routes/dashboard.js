import { Router } from 'express';
import Job from '../models/Job.js';
import Task from '../models/Task.js';
import { Notification } from '../models/Comms.js';
import { auth } from '../middleware/auth.js';
import { h, dayKey, startOfDay } from '../utils/http.js';
import { isStaffRole } from '../utils/permissions.js';
import { Attendance } from '../models/Attendance.js';
import { getSettings, workedMinutes, breakMinutes, todayRecord } from '../services/shift.js';

const r = Router();
r.use(auth);

const PENDING = ['assigned', 'accepted', 'awaiting_parts'];
const ACTIVE = ['in_progress', 'paused', 'rework'];
const DONE = ['ready_for_qc', 'qc_passed', 'ready_for_delivery'];
const FINISHED = ['qc_passed', 'ready_for_delivery'];

r.get('/', h(async (req, res) => {
  const team = isStaffRole(req.user) && req.query.scope !== 'mine';
  const jf = team ? {} : { technician: req.user._id };
  const now = new Date();
  const eod = new Date(startOfDay().getTime() + 864e5);
  const card = 'orderNo vehicle status priority deadline progress technician';

  const [pending, inProgress, completed, overdue, today, upcoming, priority, openTasks, notifs, unread, att, running] = await Promise.all([
    Job.countDocuments({ ...jf, status: { $in: PENDING } }),
    Job.countDocuments({ ...jf, status: { $in: ACTIVE } }),
    Job.countDocuments({ ...jf, status: { $in: DONE } }),
    Job.find({ ...jf, deadline: { $lt: now }, status: { $nin: FINISHED } }).select(card).populate('technician', 'name').sort({ deadline: 1 }).limit(10),
    Job.find({ ...jf, status: { $nin: [...DONE] }, $or: [{ status: { $in: ACTIVE } }, { deadline: { $lt: eod } }] }).select(card).populate('technician', 'name').sort({ priority: -1, deadline: 1 }).limit(20),
    Job.find({ ...jf, deadline: { $gte: now }, status: { $nin: DONE } }).select(card).populate('technician', 'name').sort({ deadline: 1 }).limit(6),
    Job.find({ ...jf, priority: { $in: ['urgent', 'high'] }, status: { $nin: DONE } }).select(card).populate('technician', 'name').limit(8),
    Task.find({ ...(team ? {} : { assignee: req.user._id }), status: { $in: ['todo', 'in_progress', 'paused', 'blocked', 'rework'] } }).populate('job', 'orderNo'),
    Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(5),
    Notification.countDocuments({ user: req.user._id, read: false }),
    todayRecord(req.user._id),
    Task.findOne({ runningSince: { $ne: null }, 'timeEntries.user': req.user._id }).populate('job', 'orderNo vehicle'),
  ]);

  const { shiftMinutes } = await getSettings();
  const weekStart = startOfDay();
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekRows = await Attendance.find({ user: req.user._id, date: { $gte: dayKey(weekStart) } });

  const plannedMinutes = openTasks.reduce((s, t) => s + Math.max(0, t.estimatedMinutes * (1 - t.completionPct / 100) - 0), 0);
  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
  const sortPrio = (a, b) => priorityRank[a.priority] - priorityRank[b.priority];

  res.json({
    scope: team ? 'team' : 'mine',
    counters: { today: today.length, pending, inProgress, completed, overdue: overdue.length, priority: priority.length },
    todayJobs: today.sort(sortPrio),
    overdue,
    upcoming,
    priorityJobs: priority.sort(sortPrio),
    workload: {
      openTasks: openTasks.length,
      blockedTasks: openTasks.filter((t) => t.status === 'blocked').length,
      plannedMinutes: Math.round(plannedMinutes),
      shiftMinutes,
      loadPct: Math.min(150, Math.round((plannedMinutes / shiftMinutes) * 100)),
      tasksDueToday: openTasks.filter((t) => t.dueAt && t.dueAt < eod).length,
    },
    hours: {
      clockedIn: !!att && !att.clockOut,
      onBreak: !!att?.breaks.some((b) => !b.end),
      clockIn: att?.clockIn,
      todayMinutes: workedMinutes(att),
      breakMinutes: breakMinutes(att),
      weekMinutes: weekRows.reduce((s, a) => s + workedMinutes(a), 0),
      shiftMinutes,
    },
    runningTask: running && { _id: running._id, title: running.title, job: running.job, since: running.runningSince },
    notifications: notifs,
    unread,
  });
}));

export default r;
