const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();

const ctrl = require('../controllers/chat.controller');
const { authMiddleware, requireRole } = require('../middlewares/auth.middleware');

const uploadDirectory = path.join(__dirname, '../../storage/chat');
fs.mkdirSync(uploadDirectory, { recursive: true });

const allowedTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const chatUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase().slice(0, 12);
      callback(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
    },
  }),
  fileFilter: (req, file, callback) => {
    if (!allowedTypes.has(file.mimetype)) {
      const error = new Error('Tệp không được hỗ trợ. Hãy gửi ảnh, PDF, Word, Excel, CSV hoặc TXT.');
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

function parseChatUpload(req, res, next) {
  chatUpload.single('attachment')(req, res, (error) => {
    if (error instanceof multer.MulterError) error.status = 400;
    if (error?.code === 'LIMIT_FILE_SIZE') {
      error.status = 400;
      error.message = 'Tệp đính kèm không được vượt quá 20 MB.';
    }
    next(error);
  });
}

router.use(authMiddleware, requireRole('customer', 'thu_ngan'));
router.get('/conversations', ctrl.listConversations);
router.get('/unread-count', ctrl.getUnreadCount);
router.get('/conversations/:id/messages', ctrl.getMessages);
router.post('/messages', parseChatUpload, ctrl.sendMessage);
router.get('/messages/:messageId/attachment', ctrl.downloadAttachment);
router.patch('/conversations/:id/takeover', requireRole('thu_ngan'), ctrl.takeOverConversation);
router.patch('/conversations/:id/close', requireRole('thu_ngan'), ctrl.closeConversation);

module.exports = router;
