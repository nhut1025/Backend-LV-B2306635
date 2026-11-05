const fs = require('fs');
const path = require('path');
const chatModel = require('../models/chat.model');
const { emitToRoom } = require('../utils/socket');

function formatMessage(message) {
  return {
    ...message,
    attachment_url: message.attachment_filename ? `/api/chat/messages/${message.id}/attachment` : null,
  };
}

async function listConversations(req, res, next) {
  try {
    res.json({ conversations: await chatModel.findConversations(req.user.id, req.user.role) });
  } catch (error) {
    next(error);
  }
}

async function getUnreadCount(req, res, next) {
  try {
    res.json({ unread_count: await chatModel.findUnreadCount(req.user.id, req.user.role) });
  } catch (error) {
    next(error);
  }
}

async function getMessages(req, res, next) {
  try {
    const result = await chatModel.getMessages(req.params.id, req.user.id, req.user.role);
    const messages = result.messages.map(formatMessage);
    emitToRoom('thu_ngan', 'chat:read', { conversation_id: Number(req.params.id) });
    if (req.user.role === 'customer') {
      emitToRoom(`user:${result.conversation.customer_id}`, 'chat:read', {
        conversation_id: Number(req.params.id),
      });
    }
    res.json({ conversation: result.conversation, messages });
  } catch (error) {
    next(error);
  }
}

async function sendMessage(req, res, next) {
  try {
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    const conversationId = req.body.conversation_id ? Number(req.body.conversation_id) : null;
    if (!Number.isSafeInteger(conversationId) && conversationId !== null) {
      await removeUnstoredUpload(req.file);
      return res.status(400).json({ message: 'conversation_id không hợp lệ.' });
    }
    if (Array.from(content).length > 1500) {
      await removeUnstoredUpload(req.file);
      return res.status(400).json({ message: 'Tin nhắn không được vượt quá 1.500 ký tự.' });
    }
    if (!content && !req.file) {
      return res.status(400).json({ message: 'Vui lòng nhập tin nhắn hoặc chọn tệp đính kèm.' });
    }
    const result = await chatModel.sendMessage(
      req.user.id,
      req.user.role,
      conversationId,
      content,
      req.file
        ? { ...req.file, originalname: req.file.originalname.replace(/[\\/]/g, '_').slice(0, 255) }
        : null
    );

    const message = formatMessage(result.message);
    const conversation = {
      ...result.conversation,
      id: Number(result.conversation.id),
      customer_id: Number(result.conversation.customer_id),
      staff_id: result.conversation.staff_id === null ? null : Number(result.conversation.staff_id),
    };
    if (result.isNewConversation) {
      emitToRoom('thu_ngan', 'chat:conversation-new', { conversation });
    }
    if (result.claimed) {
      emitToRoom('thu_ngan', 'chat:assigned', { conversation_id: conversation.id, staff_id: req.user.id });
    }
    emitToRoom(`user:${conversation.customer_id}`, 'chat:message-new', { conversation, message });
    if (conversation.staff_id) {
      emitToRoom(`user:${conversation.staff_id}`, 'chat:message-new', { conversation, message });
    } else {
      emitToRoom('thu_ngan', 'chat:message-new', { conversation, message });
    }
    res.status(201).json({ conversation, message });
  } catch (error) {
    await removeUnstoredUpload(req.file);
    next(error);
  }
}

async function removeUnstoredUpload(file) {
  if (!file) return;
  await fs.promises.unlink(file.path).catch((error) => {
    if (error.code !== 'ENOENT') console.error('Không xóa được tệp chat chưa lưu:', error);
  });
}

async function takeOverConversation(req, res, next) {
  try {
    const conversation = await chatModel.changeAssignment(req.params.id, req.user.id);
    const result = {
      ...conversation,
      id: Number(conversation.id),
      customer_id: Number(conversation.customer_id),
      staff_id: Number(conversation.staff_id),
    };
    emitToRoom('thu_ngan', 'chat:assigned', {
      conversation_id: result.id,
      staff_id: result.staff_id,
    });
    emitToRoom(`user:${result.customer_id}`, 'chat:assigned', {
      conversation_id: result.id,
      staff_id: result.staff_id,
      staff_name: result.staff_name,
    });
    res.json({ conversation: result });
  } catch (error) {
    next(error);
  }
}

async function closeConversation(req, res, next) {
  try {
    const conversation = await chatModel.closeConversation(req.params.id, req.user.id);
    const result = {
      ...conversation,
      id: Number(conversation.id),
      customer_id: Number(conversation.customer_id),
      staff_id: Number(conversation.staff_id),
    };
    const payload = { conversation: result };
    emitToRoom(`user:${result.customer_id}`, 'chat:closed', payload);
    emitToRoom(`user:${result.staff_id}`, 'chat:closed', payload);
    emitToRoom('thu_ngan', 'chat:closed', payload);
    res.json({ conversation: result });
  } catch (error) {
    next(error);
  }
}

async function downloadAttachment(req, res, next) {
  try {
    const attachment = await chatModel.findAttachment(req.params.messageId, req.user.id, req.user.role);
    const filePath = path.resolve(__dirname, '../../storage/chat', attachment.attachment_path);
    const storageRoot = path.resolve(__dirname, '../../storage/chat');
    if (!filePath.startsWith(`${storageRoot}${path.sep}`)) {
      return res.status(400).json({ message: 'Đường dẫn tệp không hợp lệ.' });
    }
    await fs.promises.access(filePath, fs.constants.R_OK);
    res.type(attachment.attachment_mime || 'application/octet-stream');
    res.download(filePath, attachment.attachment_filename);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ message: 'Tệp đính kèm không còn tồn tại.' });
    }
    next(error);
  }
}

module.exports = {
  closeConversation,
  downloadAttachment,
  getMessages,
  getUnreadCount,
  listConversations,
  sendMessage,
  takeOverConversation,
};
