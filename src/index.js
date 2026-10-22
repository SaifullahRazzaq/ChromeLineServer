import 'dotenv/config';
import http from 'node:http';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { initRealtime } from './services/realtime.js';
import { sweepDeadlines } from './services/deadlines.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/primebody';
const app = createApp();
let connecting;

const connect = () => {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  connecting ||= mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 }).catch((e) => {
    connecting = undefined;
    throw e;
  });
  return connecting;
};

// Serverless entry (Vercel): the module's default export is the request handler.
// Socket.IO cannot run in this mode; use a long-running host for realtime.
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

// Long-running mode (local dev, Render, Railway)
async function start() {
  const PORT = process.env.PORT || 5001;
  if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me')) {
    console.error('Refusing to start: set a strong JWT_SECRET in production.');
    process.exit(1);
  }
  await connect();
  const server = http.createServer(app);
  initRealtime(server, process.env.CLIENT_ORIGIN?.split(',') || true);
  server.listen(PORT, () => console.log(`API on :${PORT}`));
  sweepDeadlines();
  setInterval(sweepDeadlines, 15 * 60 * 1000).unref();
}

if (!process.env.VERCEL) start();
