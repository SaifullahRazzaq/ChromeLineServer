import mongoose from 'mongoose';
const { Schema } = mongoose;

export const Notification = mongoose.model(
  'Notification',
  new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      type: {
        type: String,
        enum: ['assignment', 'deadline', 'parts', 'approval', 'qc', 'comment', 'delay', 'system'],
        default: 'system',
      },
      title: String,
      body: String,
      link: String,
      read: { type: Boolean, default: false },
    },
    { timestamps: true }
  )
);

export const Message = mongoose.model(
  'Message',
  new Schema(
    {
      channel: { type: String, required: true, index: true }, // 'team' or 'job:<id>'
      sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      text: { type: String, default: '' },
      attachments: [{ url: String, name: String, mime: String }],
    },
    { timestamps: true }
  )
);

export const Setting = mongoose.model(
  'Setting',
  new Schema({ key: { type: String, unique: true }, value: Schema.Types.Mixed }, { timestamps: true })
);
