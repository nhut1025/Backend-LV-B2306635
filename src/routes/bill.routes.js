const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/bill.controller');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');

router.get('/table/:tableId', authMiddleware, requireRole('phuc_vu'), ctrl.getByTable);
router.post('/:billId/items', authMiddleware, requireRole('phuc_vu'), ctrl.addItem);
router.delete('/:billId/items/:itemId', authMiddleware, requireRole('phuc_vu'), ctrl.removeItem);

module.exports = router;