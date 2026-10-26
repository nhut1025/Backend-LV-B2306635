
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();

const ctrl = require('../controllers/user.controller');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');

const uploadDirectory = path.join(__dirname, '../../uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (req, file, callback) => {
      const extensions = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
      };
      callback(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${extensions[file.mimetype]}`);
    },
  }),
  fileFilter: (req, file, callback) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
      const error = new Error('Chỉ chấp nhận ảnh JPG, PNG, WEBP hoặc GIF.');
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

function parseAvatarUpload(req, res, next) {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      err.status = 400;
      err.message = 'Ảnh đại diện không được vượt quá 50 MB.';
    }
    next(err);
  });
}

router.get('/staff', authMiddleware, requireRole('manager'), ctrl.getStaffList);
router.post('/staff', authMiddleware, requireRole('manager'), ctrl.createStaff);
router.put('/staff/:id', authMiddleware, requireRole('manager'), ctrl.updateStaff);
router.patch('/staff/:id/active', authMiddleware, requireRole('manager'), ctrl.toggleStaffActive);
router.get('/me', authMiddleware, ctrl.getProfile);
router.put('/me', authMiddleware, ctrl.updateProfile);
router.post('/me/avatar', authMiddleware, parseAvatarUpload, ctrl.uploadAvatar);
router.put('/me/password', authMiddleware, ctrl.changePassword);
router.get('/me/reservation-summary', authMiddleware, requireRole('customer'), ctrl.getReservationSummary);
router.get('/me/excluded-ingredients', authMiddleware, requireRole('customer'), ctrl.getExcludedIngredients);
router.put('/me/excluded-ingredients', authMiddleware, requireRole('customer'), ctrl.setExcludedIngredients);

module.exports = router;
