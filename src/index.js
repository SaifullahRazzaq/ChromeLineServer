// Entry for both modes (Vercel serverless and a long-running server).
// This file is a standard Express app: `export default app`. The real app (routes, middleware)
// is loaded lazily inside it so a startup failure is reported as JSON instead of an opaque 500.
import express from 'express';

const app = express();
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
    return { inner: createApp(), connect };
  })().catch((e) => {
    boot = undefined;
    throw e;
  });
  return boot;
}

app.use(async (req, res, next) => {
  try {
    const b = await load();
    if (process.env.VERCEL && (!process.env.MONGO_URI || !process.env.JWT_SECRET)) {
      return res.status(500).json({ error: 'Server is missing MONGO_URI or JWT_SECRET environment variables' });
    }
    try {
      await b.connect();
    } catch (e) {
      console.error('Mongo connect failed:', e.message);
      return res.status(503).json({ error: 'Database unavailable', detail: String(e.message).slice(0, 200) });
    }
    req.app.locals.inner = b.inner;
    next();
  } catch (e) {
    console.error('Startup failed:', e);
    res.status(500).json({ error: 'Server failed to start', detail: String(e?.message || e).slice(0, 300) });
  }
});

app.use((req, res, next) => req.app.locals.inner(req, res, next));

// Long-running mode (local dev, Render, Railway). Socket.IO only works here.
async function start() {
  const { default: http } = await import('node:http');
  const { connect } = await load();
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

export default app;
