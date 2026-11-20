const { pool } = require('../config/db');

function createNotFoundError() {
  const error = new Error('Không tìm thấy tài khoản nhận hoàn cọc.');
  error.status = 404;
  return error;
}

async function findByUserId(userId) {
  const [rows] = await pool.query(
    `SELECT id, bank_code, account_number, account_name, is_default, created_at, updated_at
     FROM user_refund_bank_accounts
     WHERE user_id = ?
     ORDER BY is_default DESC, id DESC`,
    [userId]
  );
  return rows;
}

async function create(userId, { bankCode, accountNumber, accountName, isDefault }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (users.length === 0) throw createNotFoundError();

    const [counts] = await connection.query(
      'SELECT COUNT(*) AS account_count FROM user_refund_bank_accounts WHERE user_id = ?',
      [userId]
    );
    const makeDefault = isDefault || Number(counts[0].account_count) === 0;
    if (makeDefault) {
      await connection.query(
        'UPDATE user_refund_bank_accounts SET is_default = FALSE WHERE user_id = ?',
        [userId]
      );
    }

    const [result] = await connection.query(
      `INSERT INTO user_refund_bank_accounts
         (user_id, bank_code, account_number, account_name, is_default)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, bankCode, accountNumber, accountName, makeDefault]
    );
    await connection.commit();
    return result.insertId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function update(userId, accountId, {
  bankCode, accountNumber, accountName, isDefault,
}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (users.length === 0) throw createNotFoundError();

    const [accounts] = await connection.query(
      'SELECT id FROM user_refund_bank_accounts WHERE id = ? AND user_id = ? FOR UPDATE',
      [accountId, userId]
    );
    if (accounts.length === 0) throw createNotFoundError();

    if (isDefault) {
      await connection.query(
        'UPDATE user_refund_bank_accounts SET is_default = FALSE WHERE user_id = ?',
        [userId]
      );
    }
    await connection.query(
      `UPDATE user_refund_bank_accounts
       SET bank_code = ?, account_number = ?, account_name = ?, is_default = ?
       WHERE id = ? AND user_id = ?`,
      [bankCode, accountNumber, accountName, isDefault, accountId, userId]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function remove(userId, accountId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (users.length === 0) throw createNotFoundError();

    const [accounts] = await connection.query(
      'SELECT id, is_default FROM user_refund_bank_accounts WHERE id = ? AND user_id = ? FOR UPDATE',
      [accountId, userId]
    );
    if (accounts.length === 0) throw createNotFoundError();

    await connection.query(
      'DELETE FROM user_refund_bank_accounts WHERE id = ? AND user_id = ?',
      [accountId, userId]
    );
    if (accounts[0].is_default) {
      const [remaining] = await connection.query(
        'SELECT id FROM user_refund_bank_accounts WHERE user_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [userId]
      );
      if (remaining.length > 0) {
        await connection.query(
          'UPDATE user_refund_bank_accounts SET is_default = TRUE WHERE id = ? AND user_id = ?',
          [remaining[0].id, userId]
        );
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { findByUserId, create, update, remove };
