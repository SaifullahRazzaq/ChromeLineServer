import 'dotenv/config';
import http from 'node:http';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { initRealtime } from './services/realtime.js';
import { sweepDeadlines } from './services/deadlines.js';

const PORT = process.env.PORT || 5001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/primebody';

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me')) {
  console.error('Refusing to start: set a strong JWT_SECRET in production.');
  process.exit(1);
}

await mongoose.connect(MONGO_URI);
const server = http.createServer(createApp());
initRealtime(server, process.env.CLIENT_ORIGIN?.split(',') || true);
server.listen(PORT, () => console.log(`API on :${PORT}`));

sweepDeadlines();
setInterval(sweepDeadlines, 15 * 60 * 1000).unref();
