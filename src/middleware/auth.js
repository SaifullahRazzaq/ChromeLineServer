import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { HttpError, h } from '../utils/http.js';
import { can } from '../utils/permissions.js';

export const JWT_SECRET = () => process.env.JWT_SECRET || 'dev-secret';

export const signToken = (user) => jwt.sign({ id: user._id, role: user.role }, JWT_SECRET(), { expiresIn: '12h' });

export const verifyToken = (token) => jwt.verify(token, JWT_SECRET());

export const auth = h(async (req, _res, next) => {
  const raw = req.headers.authorization?.replace(/^Bearer /, '') || req.query.token;
  if (!raw) throw new HttpError(401, 'Authentication required');
  let payload;
  try {
    payload = verifyToken(raw);
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
  const user = await User.findById(payload.id);
  if (!user || !user.active) throw new HttpError(401, 'Account unavailable');
  req.user = user;
  next();
});

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'Insufficient role'));

export const requireCan = (name) => (req, _res, next) =>
  can[name](req.user) ? next() : next(new HttpError(403, 'Permission required'));
