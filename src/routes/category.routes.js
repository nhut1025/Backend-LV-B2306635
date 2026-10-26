const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/category.controller');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');

router.get('/', ctrl.list);
router.post('/', authMiddleware, requireRole('manager'), ctrl.create);
router.put('/:id', authMiddleware, requireRole('manager'), ctrl.update);
router.delete('/:id', authMiddleware, requireRole('manager'), ctrl.remove);

module.exports = router;
