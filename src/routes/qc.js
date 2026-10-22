import { Router } from 'express';
import Job from '../models/Job.js';
import Task from '../models/Task.js';
import { auth, requireCan } from '../middleware/auth.js';
import { h, bad, notFound, forbidden } from '../utils/http.js';
import { can, isStaffRole } from '../utils/permissions.js';
import { notify, notifyStaff } from '../services/notify.js';
import { emitAll } from '../services/realtime.js';
import { loadJob, log } from './jobs.js';

const r = Router();
r.use(auth);

// Review queue for QC approvers; technicians see their own submissions
r.get('/', h(async (req, res) => {
  const filter = can.approveQC(req.user) ? { status: { $in: ['ready_for_qc'] } } : { technician: req.user._id, status: { $in: ['ready_for_qc', 'rework', 'qc_passed'] } };
  const jobs = await Job.find(filter).select('orderNo vehicle status qc priority deadline technician progress').populate('technician', 'name').sort({ 'qc.submittedAt': 1 });
  res.json(jobs);
}));

// Technician submits finished work for quality control (also used for re-inspection after rework)
r.post('/:id/submit', h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  if (String(job.technician) !== String(req.user._id) && !isStaffRole(req.user)) throw forbidden();
  if (!['in_progress', 'rework'].includes(job.status)) throw bad(`Cannot submit QC while job is "${job.status}"`);
  if (!job.completedAt) throw bad('Complete assigned work before submitting to QC');
  const open = await Task.countDocuments({ job: job._id, status: { $ne: 'completed' } });
  if (open) throw bad(`${open} task(s) still open`);
  const unchecked = job.qc.selfChecklist.filter((c) => !c.done).length;
  if (unchecked) throw bad(`Self-inspection has ${unchecked} unchecked item(s)`);
  if (!job.photos.some((p) => p.kind === 'after' && p.at >= (job.qc.reviewedAt || new Date(0)))) {
    throw bad(job.qc.round ? 'Upload new after photos for the re-inspection' : 'Upload at least one after photo as evidence');
  }
  job.status = 'ready_for_qc';
  job.qc.round += 1;
  job.qc.submittedAt = new Date();
  log(job, req, 'qc_submitted', job.qc.round > 1 ? `Re-submitted for QC (round ${job.qc.round})` : 'Submitted for QC');
  await job.save();
  await notifyStaff({ type: 'qc', title: job.qc.round > 1 ? 'Re-inspection requested' : 'Ready for QC', body: `${job.orderNo} from ${req.user.name}`, link: `/jobs/${job._id}` });
  emitAll('job:updated', { id: job._id, status: job.status, progress: job.progress, orderNo: job.orderNo });
  res.json(job);
}));

// Pass or fail. A fail creates rework tasks for the technician.
r.post('/:id/review', requireCan('approveQC'), h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  if (job.status !== 'ready_for_qc') throw bad('Job is not awaiting QC');
  if (String(job.technician) === String(req.user._id)) throw forbidden('You cannot review your own repair');
  const passed = !!req.body.passed;
  const feedback = String(req.body.feedback || '').trim();
  const rework = (req.body.reworkTasks || []).filter((t) => t.title?.trim());
  if (!passed && !feedback && !rework.length) throw bad('Failed inspections need feedback or at least one rework task');

  job.qc.lastResult = passed ? 'passed' : 'failed';
  job.qc.feedback = feedback;
  job.qc.reviewedBy = req.user._id;
  job.qc.reviewedAt = new Date();

  if (passed) {
    job.status = 'qc_passed';
    log(job, req, 'qc_passed', 'QC passed');
  } else {
    job.status = 'rework';
    job.completedAt = undefined;
    job.progress = 80;
    job.finalChecklist.forEach((c) => (c.done = false));
    job.qc.selfChecklist.forEach((c) => (c.done = false));
    log(job, req, 'qc_failed', `QC failed: ${feedback || 'see rework tasks'}`);
    const items = rework.length ? rework : [{ title: 'Address QC feedback', instructions: feedback }];
    await Task.insertMany(items.map((t) => ({
      job: job._id, title: t.title.trim(), instructions: t.instructions || feedback, priority: 'high', assignee: t.assignee || job.technician,
      status: 'rework', estimatedMinutes: t.estimatedMinutes || 30, dueAt: job.deadline,
    })));
  }
  await job.save();
  await notify(job.technician, {
    type: 'qc', title: passed ? 'QC passed' : 'QC failed — rework required', body: `${job.orderNo}${feedback ? `: ${feedback}` : ''}`, link: `/jobs/${job._id}`,
  });
  emitAll('job:updated', { id: job._id, status: job.status, progress: job.progress, orderNo: job.orderNo });
  res.json(job);
}));

// Final sign-off marks the vehicle ready for delivery
r.post('/:id/signoff', requireCan('approveQC'), h(async (req, res) => {
  const job = await loadJob(req, { populate: false });
  if (job.status !== 'qc_passed') throw bad('Job has not passed QC');
  if (String(job.technician) === String(req.user._id)) throw forbidden('You cannot sign off your own repair');
  job.status = 'ready_for_delivery';
  job.qc.signedOffBy = req.user._id;
  job.qc.signedOffAt = new Date();
  log(job, req, 'signed_off', 'Final repair sign-off — ready for delivery');
  await job.save();
  await notify(job.technician, { type: 'qc', title: 'Vehicle signed off', body: `${job.orderNo} is ready for delivery`, link: `/jobs/${job._id}` });
  emitAll('job:updated', { id: job._id, status: job.status, progress: job.progress, orderNo: job.orderNo });
  res.json(job);
}));

export default r;
