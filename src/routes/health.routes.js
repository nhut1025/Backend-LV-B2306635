
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');

router.get('/health', async (req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    next(err);
  }
});

router.get('/health/staff-only', authMiddleware, requireRole('phuc_vu', 'thu_ngan', 'kitchen', 'manager'), (req, res) => {
  res.json({ status: 'ok', message: `Xin chào NV #${req.user.id}, bạn có quyền truy cập.` });
});

module.exports = router;
