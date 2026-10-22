import mongoose from 'mongoose';

export const SERVICES = ['Auto Body Repair', 'Collision Repair', 'Insurance Claim', 'Auto Paint Repair', 'Mechanical Repair', 'Other'];

export default mongoose.model(
  'Inquiry',
  new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 100 },
      email: { type: String, required: true, trim: true, lowercase: true, maxlength: 150 },
      phone: { type: String, required: true, trim: true, maxlength: 30 },
      service: { type: String, enum: SERVICES, default: 'Other' },
      vehicle: { type: String, trim: true, maxlength: 120, default: '' },
      message: { type: String, required: true, trim: true, maxlength: 2000 },
      status: { type: String, enum: ['new', 'contacted', 'closed'], default: 'new', index: true },
    },
    { timestamps: true }
  )
);
