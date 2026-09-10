const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Thiếu token xác thực.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const [rows] = await pool.query('SELECT is_active FROM users WHERE id = ?', [payload.id]);
    if (rows.length === 0 || rows[0].is_active === false || rows[0].is_active === 0) {
      return res.status(401).json({ message: 'Tài khoản đã bị khóa hoặc không tồn tại.' });
    }

    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn.' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Chưa xác thực.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này.' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };