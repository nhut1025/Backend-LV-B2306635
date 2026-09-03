
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();

const ctrl = require('../controllers/dish.controller');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');
const { optionalAuthMiddleware } = require('../middlewares/optionalAuth.middleware');

const uploadDirectory = path.join(__dirname, '../../uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });
const imageUpload = multer({
	storage: multer.diskStorage({
		destination: uploadDirectory,
		filename: (req, file, callback) => {
			const extension = path.extname(file.originalname).toLowerCase();
			callback(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
		},
	}),
	fileFilter: (req, file, callback) => callback(null, file.mimetype.startsWith('image/')),
	limits: { fileSize: 5 * 1024 * 1024 },
});

router.get('/', optionalAuthMiddleware, ctrl.list); // public, luôn hiển thị đầy đủ món
router.get('/:id', optionalAuthMiddleware, ctrl.getById);
router.post('/upload-image', authMiddleware, requireRole('manager'), imageUpload.single('image'), ctrl.uploadImage);
router.post('/', authMiddleware, requireRole('manager'), ctrl.create);
router.put('/:id', authMiddleware, requireRole('manager'), ctrl.update);
router.patch('/:id/availability', authMiddleware, requireRole('phuc_vu', 'kitchen'), ctrl.toggleAvailability);
router.delete('/:id', authMiddleware, requireRole('manager'), ctrl.remove);

module.exports = router;
