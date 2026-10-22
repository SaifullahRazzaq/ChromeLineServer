import mongoose from 'mongoose';
const { Schema } = mongoose;

export const JOB_STATUSES = [
  'assigned',
  'accepted',
  'in_progress',
  'paused',
  'awaiting_parts',
  'ready_for_qc',
  'rework',
  'qc_passed',
  'ready_for_delivery',
];

export const REPAIR_TYPES = [
  'body_panel',
  'dent_removal',
  'bumper',
  'frame',
  'paint_prep',
  'color_matching',
  'painting',
  'parts_replacement',
  'mechanical',
  'reassembly',
];

const checkItem = new Schema(
  { key: String, label: String, done: { type: Boolean, default: false }, note: { type: String, default: '' }, by: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date },
  { _id: false }
);

const photo = new Schema(
  {
    kind: { type: String, enum: ['before', 'damage', 'progress', 'after', 'inspection', 'qc'], required: true },
    url: { type: String, required: true },
    caption: { type: String, default: '' },
    annotations: [{ x: Number, y: Number, text: String }],
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const event = new Schema(
  { type: String, text: String, by: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } },
  { _id: false }
);

const schema = new Schema(
  {
    orderNo: { type: String, required: true, unique: true },
    customer: { name: String, phone: String, email: String },
    vehicle: { make: String, model: String, year: Number, vin: String, plate: String, color: String, mileage: Number },
    damageDescription: { type: String, default: '' },
    estimate: {
      amount: { type: Number, default: 0 },
      customerApproved: { type: Boolean, default: false },
      approvedAt: Date,
      supplements: [
        {
          amount: Number,
          reason: String,
          status: { type: String, enum: ['requested', 'approved', 'rejected'], default: 'requested' },
          requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
          at: { type: Date, default: Date.now },
        },
      ],
    },
    insurance: {
      provider: { type: String, default: '' },
      claimNo: { type: String, default: '' },
      status: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
    },
    instructions: { type: String, default: '' },
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    deadline: Date,
    status: { type: String, enum: JOB_STATUSES, default: 'assigned', index: true },
    repairTypes: [{ type: String, enum: REPAIR_TYPES }],
    technician: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    supervisor: { type: Schema.Types.ObjectId, ref: 'User' },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    acceptedAt: Date,
    startedAt: Date,
    completedAt: Date,
    // Pause bookkeeping so downtime is auditable
    pauses: [{ start: Date, end: Date, reason: String }],

    internalNotes: [{ text: String, by: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } }],
    comments: [{ text: String, by: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } }],
    history: [event],

    delays: [{ reason: String, newDeadline: Date, by: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } }],
    additionalDamage: [
      {
        description: String,
        severity: { type: String, enum: ['minor', 'moderate', 'severe'], default: 'minor' },
        photos: [String],
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: Date.now },
      },
    ],
    inspectionRequests: [{ note: String, by: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now }, resolved: { type: Boolean, default: false } }],

    inspection: {
      completed: { type: Boolean, default: false },
      completedAt: Date,
      notes: { type: String, default: '' },
      checklist: [checkItem],
      // Interactive diagram pins: x/y are percentages of the diagram view
      damageMarkers: [
        {
          view: { type: String, enum: ['front', 'rear', 'left', 'right', 'top'], default: 'front' },
          x: Number,
          y: Number,
          severity: { type: String, enum: ['minor', 'moderate', 'severe'], default: 'minor' },
          note: String,
          existing: { type: Boolean, default: false }, // pre-existing damage, not caused by the claim
        },
      ],
      equipmentIssues: [{ description: String, by: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } }],
    },

    // Repair-specific checklists keyed by repair type
    workflows: [{ type: { type: String }, steps: [checkItem] }],
    finalChecklist: [checkItem],

    photos: [photo],

    partsUsed: [
      {
        part: { type: Schema.Types.ObjectId, ref: 'Part' },
        name: String,
        qty: Number,
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: Date.now },
      },
    ],
    requiredParts: [{ part: { type: Schema.Types.ObjectId, ref: 'Part' }, name: String, qty: Number }],

    qc: {
      round: { type: Number, default: 0 },
      selfChecklist: [checkItem],
      submittedAt: Date,
      lastResult: { type: String, enum: ['none', 'passed', 'failed'], default: 'none' },
      feedback: { type: String, default: '' },
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      reviewedAt: Date,
      signedOffBy: { type: Schema.Types.ObjectId, ref: 'User' },
      signedOffAt: Date,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Job', schema);
