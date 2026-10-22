import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['technician', 'supervisor', 'admin'], default: 'technician' },
    // Per-user grants layered on top of the role matrix
    permissions: {
      approveQC: { type: Boolean, default: false },
      viewFinancials: { type: Boolean, default: false },
      manageTechnicians: { type: Boolean, default: false },
    },
    specialty: { type: String, default: '' },
    phone: { type: String, default: '' },
    employeeId: { type: String, trim: true, unique: true, sparse: true },
    joinedAt: { type: Date },
    skills: [{ type: String, trim: true }],
    address: { type: String, default: '' },
    emergencyContact: { name: { type: String, default: '' }, phone: { type: String, default: '' } },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

schema.set('toJSON', {
  transform: (_d, r) => {
    delete r.passwordHash;
    return r;
  },
});

export default mongoose.model('User', schema);
