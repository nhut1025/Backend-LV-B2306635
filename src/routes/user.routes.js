
const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/user.controller');
const { authMiddleware } = require('../middlewares/auth.middleware');

router.get('/me', authMiddleware, ctrl.getProfile);
router.put('/me', authMiddleware, ctrl.updateProfile);
router.get('/me/excluded-ingredients', authMiddleware, ctrl.getExcludedIngredients);
router.put('/me/excluded-ingredients', authMiddleware, ctrl.setExcludedIngredients);

module.exports = router;
