import mongoose from 'mongoose';
const { Schema } = mongoose;

export const Attendance = mongoose.model(
  'Attendance',
  new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      date: { type: String, required: true }, // YYYY-MM-DD, server local day
      clockIn: Date,
      clockOut: Date,
      breaks: [{ start: Date, end: Date }],
      overtimeMinutes: { type: Number, default: 0 },
    },
    { timestamps: true }
  ).index({ user: 1, date: 1 }, { unique: true })
);

export const LeaveRequest = mongoose.model(
  'LeaveRequest',
  new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      from: { type: Date, required: true },
      to: { type: Date, required: true },
      type: { type: String, enum: ['annual', 'sick', 'casual', 'unpaid'], default: 'casual' },
      reason: String,
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
      decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true }
  )
);
