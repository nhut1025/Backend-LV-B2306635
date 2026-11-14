const express = require('express');
const ctrl = require('../controllers/recommendation.controller');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');
const { optionalAuthMiddleware } = require('../middlewares/optionalAuth.middleware');

const router = express.Router();

router.get('/', optionalAuthMiddleware, ctrl.list);
router.get('/me', authMiddleware, requireRole('customer'), ctrl.listMine);

module.exports = router;
