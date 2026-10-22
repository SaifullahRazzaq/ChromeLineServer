// Entry for both modes. The app itself is loaded lazily so a startup failure on a
// serverless host is reported in the response instead of an opaque platform 500.
// Vercel's Express detection scans the entry file for an express import, so keep this one.
import express from 'express';

export const framework = express.name;

let boot;

function load() {
  boot ||= (async () => {
    await import('dotenv/config');
    const { default: mongoose } = await import('mongoose');
    const { createApp } = await import('./createApp.js');
    const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/primebody';
    let connecting;
    const connect = () => {
      if (mongoose.connection.readyState === 1) return Promise.resolve();
      connecting ||= mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 }).catch((e) => {
        connecting = undefined;
        throw e;
      });
      return connecting;
    };
    return { app: createApp(), connect };
  })().catch((e) => {
    boot = undefined;
    throw e;
  });
  return boot;
}

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

// Serverless entry (Vercel). Socket.IO cannot run in this mode; use a long-running host for realtime.
export default async function handler(req, res) {
  let b;
  try {
    b = await load();
  } catch (e) {
    console.error('Startup failed:', e);
    return send(res, 500, { error: 'Server failed to start', detail: String(e?.message || e).slice(0, 300) });
  }
  if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
    return send(res, 500, { error: 'Server is missing MONGO_URI or JWT_SECRET environment variables' });
  }
  try {
    await b.connect();
  } catch (e) {
    console.error('Mongo connect failed:', e.message);
    return send(res, 503, { error: 'Database unavailable', detail: String(e.message).slice(0, 200) });
  }
  return b.app(req, res);
}

// Long-running mode (local dev, Render, Railway)
async function start() {
  const { default: http } = await import('node:http');
  const { app, connect } = await load();
  const { initRealtime } = await import('./services/realtime.js');
  const { sweepDeadlines } = await import('./services/deadlines.js');
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

if (!process.env.VERCEL) start().catch((e) => { console.error(e); process.exit(1); });
