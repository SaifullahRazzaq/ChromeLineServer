import { Notification } from '../models/Comms.js';
import User from '../models/User.js';
import { emitToUser } from './realtime.js';

export async function notify(userIds, { type = 'system', title, body = '', link = '' }) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))];
  if (!ids.length) return;
  const docs = await Notification.insertMany(ids.map((user) => ({ user, type, title, body, link })));
  docs.forEach((n) => emitToUser(n.user, 'notification', n));
}

// Everyone who reviews work: supervisors and admins
export async function notifyStaff(payload) {
  const staff = await User.find({ role: { $in: ['supervisor', 'admin'] }, active: true }).select('_id');
  await notify(staff.map((s) => s._id), payload);
}
