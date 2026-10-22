import { Attendance } from '../models/Attendance.js';
import { Setting } from '../models/Comms.js';
import { HttpError, dayKey } from '../utils/http.js';

export const DEFAULT_SETTINGS = { shiftMinutes: 480, maxBreakMinutes: 60, workshopName: 'Chromeline Workshop', autoClockOutHours: 14 };

export async function getSettings() {
  const rows = await Setting.find();
  return rows.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), { ...DEFAULT_SETTINGS });
}

export const workedMinutes = (a, now = new Date()) => {
  if (!a?.clockIn) return 0;
  const end = a.clockOut || now;
  const brk = (a.breaks || []).reduce((s, b) => s + ((b.end || now) - b.start), 0);
  return Math.max(0, Math.round((end - a.clockIn - brk) / 60000));
};

export const breakMinutes = (a, now = new Date()) =>
  Math.round((a?.breaks || []).reduce((s, b) => s + ((b.end || now) - b.start), 0) / 60000);

export const todayRecord = (userId) => Attendance.findOne({ user: userId, date: dayKey() });

// Timers and labor only count while the technician is clocked in and not on break
export async function requireActiveShift(userId) {
  const a = await todayRecord(userId);
  if (!a?.clockIn || a.clockOut) throw new HttpError(400, 'Clock in before starting a timer');
  if (a.breaks.some((b) => !b.end)) throw new HttpError(400, 'End your break before starting a timer');
  return a;
}
