import { Server } from 'socket.io';
import { verifyToken } from '../middleware/auth.js';
import User from '../models/User.js';

let io;

export function initRealtime(httpServer, origin) {
  io = new Server(httpServer, { cors: { origin, credentials: true } });

  io.use(async (socket, next) => {
    try {
      const { id } = verifyToken(socket.handshake.auth?.token);
      const user = await User.findById(id);
      if (!user?.active) throw new Error('inactive');
      socket.data.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const u = socket.data.user;
    socket.join(`user:${u._id}`);
    socket.join(`role:${u.role}`);
    socket.join('team');
  });
  return io;
}

export const emitToUser = (userId, event, payload) => io?.to(`user:${userId}`).emit(event, payload);
export const emitToRole = (role, event, payload) => io?.to(`role:${role}`).emit(event, payload);
export const emitAll = (event, payload) => io?.emit(event, payload);
