const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/finance.controller');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');

router.get('/bills', authMiddleware, requireRole('manager'), ctrl.listBills);
router.get('/deposits', authMiddleware, requireRole('manager'), ctrl.listDepositTransactions);
router.get('/bills/:billId', authMiddleware, requireRole('manager'), ctrl.getBillDetail);

module.exports = router;