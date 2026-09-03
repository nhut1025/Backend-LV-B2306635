
const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/user.controller');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');

router.get('/staff', authMiddleware, requireRole('manager'), ctrl.getStaffList);
router.post('/staff', authMiddleware, requireRole('manager'), ctrl.createStaff);
router.put('/staff/:id', authMiddleware, requireRole('manager'), ctrl.updateStaff);
router.patch('/staff/:id/active', authMiddleware, requireRole('manager'), ctrl.toggleStaffActive);
router.get('/me', authMiddleware, ctrl.getProfile);
router.put('/me', authMiddleware, ctrl.updateProfile);
router.get('/me/excluded-ingredients', authMiddleware, ctrl.getExcludedIngredients);
router.put('/me/excluded-ingredients', authMiddleware, ctrl.setExcludedIngredients);

module.exports = router;
