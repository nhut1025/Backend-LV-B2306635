
const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/table.controller');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');

router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);
router.post('/', authMiddleware, requireRole('manager'), ctrl.create);
router.put('/:id', authMiddleware, requireRole('manager'), ctrl.update);
router.delete('/:id', authMiddleware, requireRole('manager'), ctrl.remove);

module.exports = router;
