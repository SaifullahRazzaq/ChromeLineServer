import Job from '../models/Job.js';
import { Notification } from '../models/Comms.js';
import { notify } from './notify.js';

const OPEN = { $nin: ['qc_passed', 'ready_for_delivery'] };

// Reminds technicians about jobs due within 24h or overdue, at most once per job per day
export async function sweepDeadlines() {
  try {
    const now = new Date();
    const soon = new Date(now.getTime() + 864e5);
    const jobs = await Job.find({ technician: { $ne: null }, status: OPEN, deadline: { $lt: soon } }).select('orderNo technician deadline');
    const since = new Date(now.getTime() - 864e5);
    for (const j of jobs) {
      const already = await Notification.exists({ user: j.technician, type: 'deadline', link: `/jobs/${j._id}`, createdAt: { $gte: since } });
      if (already) continue;
      const overdue = j.deadline < now;
      await notify(j.technician, {
        type: 'deadline', title: overdue ? 'Job overdue' : 'Deadline within 24 hours',
        body: `${j.orderNo} · due ${j.deadline.toLocaleString()}`, link: `/jobs/${j._id}`,
      });
    }
  } catch (e) {
    console.error('deadline sweep failed', e.message);
  }
}
