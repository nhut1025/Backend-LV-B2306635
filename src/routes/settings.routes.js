const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/settings.controller');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');

router.get('/bank', authMiddleware, requireRole('manager'), ctrl.getBank);
router.put('/bank', authMiddleware, requireRole('manager'), ctrl.updateBank);

module.exports = router;