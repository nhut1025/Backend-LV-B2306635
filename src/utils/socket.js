// src/utils/socket.js
//
// Khởi tạo socket.io dùng chung toàn backend. Mỗi client phải gửi JWT khi kết nối
// (socket.handshake.auth.token) — kiểm tra y như authMiddleware (hợp lệ + còn is_active).
// Sau khi xác thực, kitchen và phuc_vu được tự động vào "phòng" (room) cùng tên role,
// để phát sự kiện đúng đối tượng, không gửi lan sang role khác.

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

let io = null;

function initSocket(httpServer) {
  io = new Server(httpServer, { cors: { origin: true } });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('Thiếu token xác thực.'));

      const payload = jwt.verify(token, process.env.JWT_SECRET);

      const [rows] = await pool.query('SELECT is_active FROM users WHERE id = ?', [payload.id]);
      if (rows.length === 0 || !rows[0].is_active) {
        return next(new Error('Tài khoản đã bị khóa hoặc không tồn tại.'));
      }

      socket.data.user = payload;
      next();
    } catch (err) {
      next(new Error('Token không hợp lệ hoặc đã hết hạn.'));
    }
  });

  io.on('connection', (socket) => {
    const { role } = socket.data.user;
    if (role === 'kitchen' || role === 'phuc_vu' || role === 'thu_ngan') {
      socket.join(role);
    }
  });

  return io;
}

// Phát sự kiện tới 1 phòng. Nếu socket chưa khởi tạo thì bỏ qua êm, không làm hỏng API REST.
function emitToRoom(room, event, payload) {
  if (!io) return;
  io.to(room).emit(event, payload);
}

module.exports = { initSocket, emitToRoom };