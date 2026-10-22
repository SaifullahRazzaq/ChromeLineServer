import 'dotenv/config';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';

// Vercel entry point. The Express app is built once per warm instance and the
// Mongo connection is cached across invocations. Socket.IO is not available here.
const app = createApp();
let connecting;

const connect = () => {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  connecting ||= mongoose
    .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 })
    .catch((e) => {
      connecting = undefined;
      throw e;
    });
  return connecting;
};

export default async function handler(req, res) {
  if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
    return res.status(500).json({ error: 'Server is missing MONGO_URI or JWT_SECRET environment variables' });
  }
  try {
    await connect();
  } catch (e) {
    console.error('Mongo connect failed:', e.message);
    return res.status(503).json({ error: 'Database unavailable' });
  }
  return app(req, res);
}
