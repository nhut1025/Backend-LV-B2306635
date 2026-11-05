const { pool } = require('../config/db');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function findConversations(userId, role) {
  const isCustomer = role === 'customer';
  const where = isCustomer
    ? 'c.customer_id = ?'
    : "c.status = 'open'";
  const unreadSender = isCustomer ? 'm.sender_id <> c.customer_id' : 'm.sender_id = c.customer_id';
  const params = isCustomer ? [userId] : [];

  const [rows] = await pool.query(
    `SELECT c.id, c.customer_id, c.staff_id, c.status, c.created_at, c.closed_at,
            customer.full_name AS customer_name, staff.full_name AS staff_name,
            last_message.content AS last_message,
            last_message.created_at AS last_message_at,
            last_message.attachment_filename AS last_attachment_filename,
            (SELECT COUNT(*) FROM messages m
             WHERE m.conversation_id = c.id AND m.is_read = 0 AND ${unreadSender}) AS unread_count
     FROM conversations c
     JOIN users customer ON customer.id = c.customer_id
     LEFT JOIN users staff ON staff.id = c.staff_id
     LEFT JOIN messages last_message ON last_message.id = (
       SELECT m2.id FROM messages m2
       WHERE m2.conversation_id = c.id ORDER BY m2.id DESC LIMIT 1
     )
     WHERE ${where}
     ORDER BY COALESCE(last_message.created_at, c.created_at) DESC, c.id DESC`,
    params
  );
  return rows;
}

async function findUnreadCount(userId, role) {
  const [rows] = await pool.query(
    role === 'customer'
      ? `SELECT COUNT(*) AS unread_count FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.customer_id = ? AND m.sender_id <> c.customer_id AND m.is_read = 0`
      : `SELECT COUNT(*) AS unread_count FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.status = 'open' AND m.sender_id = c.customer_id AND m.is_read = 0`,
    role === 'customer' ? [userId] : []
  );
  return Number(rows[0].unread_count);
}

async function assertCanAccess(connection, conversationId, userId, role, lock = false) {
  const [rows] = await connection.query(
    `SELECT id, customer_id, staff_id, status
     FROM conversations WHERE id = ?${lock ? ' FOR UPDATE' : ''}`,
    [conversationId]
  );
  const conversation = rows[0];
  if (!conversation) throw httpError(404, 'Không tìm thấy hội thoại.');
  if (role === 'customer' && Number(conversation.customer_id) !== Number(userId)) {
    throw httpError(404, 'Không tìm thấy hội thoại.');
  }
  if (role === 'thu_ngan') {
    const assignedToAnother = conversation.staff_id !== null
      && Number(conversation.staff_id) !== Number(userId);
    const unassignedButClosed = conversation.staff_id === null && conversation.status !== 'open';
    if (assignedToAnother || unassignedButClosed) {
      throw httpError(403, 'Hội thoại không thuộc hộp thư của bạn.');
    }
  }
  return conversation;
}

async function insertMessage(connection, conversationId, userId, content, file) {
  const [result] = await connection.query(
    `INSERT INTO messages
       (conversation_id, sender_id, content, attachment_filename, attachment_mime, attachment_size, attachment_path)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      conversationId,
      userId,
      content,
      file?.originalname || null,
      file?.mimetype || null,
      file ? file.size : null,
      file?.filename || null,
    ]
  );
  const [rows] = await connection.query(
    `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at, m.is_read,
            m.attachment_filename, m.attachment_mime, m.attachment_size, u.full_name AS sender_name
     FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`,
    [result.insertId]
  );
  return rows[0];
}

async function sendCustomerMessage(userId, conversationId, content, file) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);

    let conversation;
    if (conversationId) {
      const [rows] = await connection.query(
        'SELECT id, customer_id, staff_id, status FROM conversations WHERE id = ? FOR UPDATE',
        [conversationId]
      );
      if (!rows[0] || Number(rows[0].customer_id) !== Number(userId)) {
        throw httpError(404, 'Không tìm thấy hội thoại.');
      }
      if (rows[0].status === 'open') conversation = rows[0];
    }

    if (!conversation) {
      const [rows] = await connection.query(
        `SELECT id, customer_id, staff_id, status FROM conversations
         WHERE customer_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [userId]
      );
      conversation = rows[0];
    }

    let isNewConversation = false;
    if (!conversation) {
      const [result] = await connection.query(
        "INSERT INTO conversations (customer_id, status) VALUES (?, 'open')",
        [userId]
      );
      conversation = { id: result.insertId, customer_id: userId, staff_id: null, status: 'open' };
      isNewConversation = true;
    }

    const message = await insertMessage(connection, conversation.id, userId, content, file);
    await connection.commit();
    return { conversation, message, isNewConversation, claimed: false };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function sendStaffMessage(userId, conversationId, content, file) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const conversation = await assertCanAccess(connection, conversationId, userId, 'thu_ngan', true);
    if (conversation.status !== 'open') throw httpError(409, 'Hội thoại đã đóng.');

    const claimed = conversation.staff_id === null;
    if (claimed) {
      await connection.query('UPDATE conversations SET staff_id = ? WHERE id = ?', [userId, conversationId]);
    }
    const message = await insertMessage(connection, conversationId, userId, content, file);
    await connection.commit();
    return {
      conversation: { ...conversation, staff_id: claimed ? userId : conversation.staff_id },
      message,
      isNewConversation: false,
      claimed,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function sendMessage(userId, role, conversationId, content, file) {
  if (role === 'customer') return sendCustomerMessage(userId, conversationId, content, file);
  if (!conversationId) throw httpError(400, 'Thu ngân cần chọn hội thoại trước khi gửi tin.');
  return sendStaffMessage(userId, conversationId, content, file);
}

async function getMessages(conversationId, userId, role) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const conversation = await assertCanAccess(connection, conversationId, userId, role);
    await connection.query(
      `UPDATE messages SET is_read = 1
       WHERE conversation_id = ? AND sender_id <> ? AND is_read = 0`,
      [conversationId, userId]
    );
    const [messages] = await connection.query(
      `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at, m.is_read,
              m.attachment_filename, m.attachment_mime, m.attachment_size, u.full_name AS sender_name
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = ? ORDER BY m.id ASC`,
      [conversationId]
    );
    await connection.commit();
    return { conversation, messages };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function changeAssignment(conversationId, userId) {
  const [result] = await pool.query(
    "UPDATE conversations SET staff_id = ? WHERE id = ? AND status = 'open'",
    [userId, conversationId]
  );
  if (result.affectedRows === 0) {
    const [rows] = await pool.query(
      'SELECT id, staff_id, status FROM conversations WHERE id = ?',
      [conversationId]
    );
    if (!rows[0]) throw httpError(404, 'Không tìm thấy hội thoại.');
    if (rows[0].status !== 'open' || Number(rows[0].staff_id) !== Number(userId)) {
      throw httpError(409, 'Không thể tiếp quản hội thoại đã đóng.');
    }
  }
  const [rows] = await pool.query(
    `SELECT c.id, c.customer_id, c.staff_id, c.status, customer.full_name AS customer_name,
            staff.full_name AS staff_name
     FROM conversations c JOIN users customer ON customer.id = c.customer_id
     LEFT JOIN users staff ON staff.id = c.staff_id WHERE c.id = ?`,
    [conversationId]
  );
  return rows[0];
}

async function closeConversation(conversationId, userId) {
  const [result] = await pool.query(
    `UPDATE conversations SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ?
     WHERE id = ? AND staff_id = ? AND status = 'open'`,
    [userId, conversationId, userId]
  );
  if (result.affectedRows === 0) {
    const [rows] = await pool.query('SELECT id FROM conversations WHERE id = ?', [conversationId]);
    if (!rows[0]) throw httpError(404, 'Không tìm thấy hội thoại.');
    throw httpError(409, 'Chỉ thu ngân đang nhận mới có thể đóng hội thoại.');
  }
  const [rows] = await pool.query(
    `SELECT c.id, c.customer_id, c.staff_id, c.status, c.closed_at,
            customer.full_name AS customer_name
     FROM conversations c JOIN users customer ON customer.id = c.customer_id WHERE c.id = ?`,
    [conversationId]
  );
  return rows[0];
}

async function findAttachment(messageId, userId, role) {
  const accessCondition = role === 'customer'
    ? 'c.customer_id = ?'
    : '(c.staff_id = ? OR (c.staff_id IS NULL AND c.status = \'open\'))';
  const [rows] = await pool.query(
    `SELECT m.attachment_path, m.attachment_filename, m.attachment_mime
     FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE m.id = ? AND ${accessCondition}`,
    [messageId, userId]
  );
  if (!rows[0] || !rows[0].attachment_path) throw httpError(404, 'Không tìm thấy tệp đính kèm.');
  return rows[0];
}

module.exports = {
  changeAssignment,
  closeConversation,
  findAttachment,
  findConversations,
  findUnreadCount,
  getMessages,
  sendMessage,
};
