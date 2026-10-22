import mongoose from 'mongoose';
const { Schema } = mongoose;

const schema = new Schema(
  {
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    title: { type: String, required: true },
    instructions: { type: String, default: '' },
    repairType: { type: String, default: '' },
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    assignee: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    dependencies: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
    estimatedMinutes: { type: Number, default: 60 },
    status: { type: String, enum: ['todo', 'in_progress', 'paused', 'blocked', 'review', 'completed', 'rework'], default: 'todo', index: true },
    completionPct: { type: Number, min: 0, max: 100, default: 0 },
    // Timer entries are written by the server only, so timesheets stay auditable
    timeEntries: [{ start: Date, end: Date, user: { type: Schema.Types.ObjectId, ref: 'User' } }],
    runningSince: Date,
    blocked: { reason: String, at: Date, by: { type: Schema.Types.ObjectId, ref: 'User' } },
    reassignRequest: {
      reason: String,
      requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      at: Date,
      status: { type: String, enum: ['pending', 'approved', 'rejected'] },
    },
    review: { by: { type: Schema.Types.ObjectId, ref: 'User' }, approved: Boolean, note: String, at: Date },
    reworkOf: { type: Schema.Types.ObjectId, ref: 'Task' },
    dueAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

schema.methods.actualMinutes = function () {
  const now = Date.now();
  // timeEntries is absent when the task was loaded with a partial projection (e.g. populated as a dependency)
  return Math.round(
    (this.timeEntries || []).reduce((s, e) => s + ((e.end ? e.end.getTime() : now) - e.start.getTime()) / 60000, 0)
  );
};

schema.set('toJSON', { virtuals: true, transform: (_d, r) => { delete r.id; return r; } });
schema.virtual('actualMins').get(function () { return this.actualMinutes(); });

export default mongoose.model('Task', schema);
