const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/reservation.controller');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');

router.get('/suggest-tables', authMiddleware, requireRole('customer'), ctrl.suggestTables);
router.post('/', authMiddleware, requireRole('customer'), ctrl.createHold);
router.get('/pending-deposits', authMiddleware, requireRole('thu_ngan'), ctrl.listPendingDeposits);
router.get('/upcoming', authMiddleware, requireRole('phuc_vu'), ctrl.listUpcoming);
router.get('/', authMiddleware, requireRole('customer'), ctrl.listMine);
router.get('/:id', authMiddleware, requireRole('customer'), ctrl.getMineById);
router.get('/:id/deposit-qr', authMiddleware, requireRole('customer'), ctrl.getDepositQr);
router.patch('/:id/confirm-deposit', authMiddleware, requireRole('thu_ngan'), ctrl.confirmDeposit);
router.patch('/:id/confirm-arrival', authMiddleware, requireRole('phuc_vu'), ctrl.confirmArrival);

module.exports = router;