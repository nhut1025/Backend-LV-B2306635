const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/reservation.controller');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');

router.get('/suggest-tables', authMiddleware, requireRole('customer'), ctrl.suggestTables);
router.post('/', authMiddleware, requireRole('customer'), ctrl.createHold);
router.get('/', authMiddleware, requireRole('customer'), ctrl.listMine);
router.get('/:id', authMiddleware, requireRole('customer'), ctrl.getMineById);

module.exports = router;
