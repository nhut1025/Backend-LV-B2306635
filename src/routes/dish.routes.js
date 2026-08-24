
const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/dish.controller');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');
const { optionalAuthMiddleware } = require('../middlewares/optionalAuth.middleware');

router.get('/', optionalAuthMiddleware, ctrl.list); // public, lọc theo user nếu có đăng nhập
router.get('/:id', optionalAuthMiddleware, ctrl.getById);
router.post('/', authMiddleware, requireRole('staff'), ctrl.create);
router.put('/:id', authMiddleware, requireRole('staff'), ctrl.update);
router.patch('/:id/availability', authMiddleware, requireRole('staff'), ctrl.toggleAvailability);
router.delete('/:id', authMiddleware, requireRole('staff'), ctrl.remove);

module.exports = router;
