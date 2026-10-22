import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import jobRoutes from './routes/jobs.js';
import taskRoutes from './routes/tasks.js';
import partRoutes from './routes/parts.js';
import qcRoutes from './routes/qc.js';
import attendanceRoutes from './routes/attendance.js';
import commsRoutes from './routes/comms.js';
import adminRoutes from './routes/admin.js';
import contactRoutes from './routes/contact.js';
import trackRoutes from './routes/track.js';
import { errorHandler } from './utils/http.js';
import { UPLOAD_DIR } from './services/storage.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || true, credentials: true }));
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
  app.use(express.json({ limit: '1mb' }));
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));

  const running = (_req, res) => res.json({ status: 'ok', message: 'PrimeBody API is running' });
  app.get('/', running);
  app.get('/api', running);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/contact', contactRoutes);
  app.use('/api/track', trackRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/jobs', jobRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/parts', partRoutes);
  app.use('/api/qc', qcRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api', commsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}
