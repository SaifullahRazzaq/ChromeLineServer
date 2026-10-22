import mongoose from 'mongoose';
const { Schema } = mongoose;

export const Part = mongoose.model(
  'Part',
  new Schema(
    {
      sku: { type: String, required: true, unique: true },
      name: { type: String, required: true },
      category: { type: String, default: 'general' },
      stock: { type: Number, default: 0 },
      reserved: { type: Number, default: 0 },
      location: { type: String, default: '' },
      unitCost: { type: Number, default: 0, min: 0 },
      reorderLevel: { type: Number, default: 5, min: 0 },
      supplier: { type: String, default: '', trim: true },
      description: { type: String, default: '' },
      active: { type: Boolean, default: true },
    },
    { timestamps: true }
  )
);

export const PartRequest = mongoose.model(
  'PartRequest',
  new Schema(
    {
      job: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
      part: { type: Schema.Types.ObjectId, ref: 'Part' },
      name: { type: String, required: true },
      qty: { type: Number, default: 1, min: 1 },
      kind: { type: String, enum: ['inventory', 'new', 'damaged', 'missing'], default: 'inventory' },
      status: { type: String, enum: ['requested', 'approved', 'ordered', 'issued', 'rejected'], default: 'requested', index: true },
      note: { type: String, default: '' },
      requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      handledBy: { type: Schema.Types.ObjectId, ref: 'User' },
      statusLog: [{ status: String, by: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } }],
    },
    { timestamps: true }
  )
);

export const StockMovement = mongoose.model(
  'StockMovement',
  new Schema(
    {
      part: { type: Schema.Types.ObjectId, ref: 'Part', required: true, index: true },
      type: { type: String, enum: ['initial', 'receive', 'issue', 'correction'], required: true },
      delta: { type: Number, required: true },
      balanceAfter: { type: Number, required: true },
      note: { type: String, default: '' },
      job: { type: Schema.Types.ObjectId, ref: 'Job' },
      by: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true }
  )
);
