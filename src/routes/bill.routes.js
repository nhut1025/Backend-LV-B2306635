const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/bill.controller');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');

router.get('/table/:tableId', authMiddleware, requireRole('phuc_vu'), ctrl.getByTable);
router.post('/:billId/items', authMiddleware, requireRole('phuc_vu'), ctrl.addItem);
router.delete('/:billId/items/:itemId', authMiddleware, requireRole('phuc_vu'), ctrl.removeItem);
router.get('/kitchen-queue', authMiddleware, requireRole('kitchen'), ctrl.kitchenQueue);
router.get('/ready-items', authMiddleware, requireRole('phuc_vu'), ctrl.readyItems);
router.patch('/items/:itemId/advance', authMiddleware, requireRole('kitchen'), ctrl.advanceItem);
router.patch('/items/:itemId/serve', authMiddleware, requireRole('phuc_vu'), ctrl.serveItem);
router.get('/payable', authMiddleware, requireRole('thu_ngan'), ctrl.listPayable);
router.get('/:billId/payment-summary', authMiddleware, requireRole('thu_ngan'), ctrl.getPaymentSummary);
router.get('/:billId/payment-qr', authMiddleware, requireRole('thu_ngan'), ctrl.getPaymentQr);
router.patch('/:billId/pay', authMiddleware, requireRole('thu_ngan'), ctrl.payBill);

module.exports = router;