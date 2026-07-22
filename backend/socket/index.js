const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { setIo } = require('../services/dispatchSocketService');

function initSocketServer(httpServer, { allowedOrigins = [] } = {}) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: allowedOrigins.length ? allowedOrigins : true,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Unauthorized'));
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user?.user_id;
    const role = socket.user?.role;
    if (userId) socket.join(`dispatch-user-${userId}`);
    if (role === 'admin' || role === 'super_admin') {
      socket.join('dispatch-admin');
    }
  });

  setIo(io);
  console.log('Socket.IO initialized');
  return io;
}

module.exports = { initSocketServer };
