const { pool } = require('../config/db');

async function findAll() {
  const [rows] = await pool.query(
    'SELECT id, table_number, capacity, status FROM restaurant_tables ORDER BY table_number'
  );
  return rows;
}

async function findById(id) {
  const [rows] = await pool.query('SELECT * FROM restaurant_tables WHERE id = ?', [id]);
  return rows;
}

async function create(tableNumber, capacity) {
  return pool.query(
    `INSERT INTO restaurant_tables (table_number, capacity, status) VALUES (?, ?, 'trong')`,
    [tableNumber, capacity]
  );
}

async function update(id, tableNumber, capacity) {
  return pool.query(
    'UPDATE restaurant_tables SET table_number = ?, capacity = ? WHERE id = ?',
    [tableNumber, capacity, id]
  );
}

async function findStatusById(id) {
  const [rows] = await pool.query('SELECT status FROM restaurant_tables WHERE id = ?', [id]);
  return rows;
}

async function remove(id) {
  return pool.query('DELETE FROM restaurant_tables WHERE id = ?', [id]);
}

// ===== Phase 4: vận hành nhân viên phục vụ =====
// Khách vãng lai: chỉ cho phép khi bàn đang trống, chuyển thẳng sang co_khach.
async function assignWalkIn(id) {
  return pool.query(
    `UPDATE restaurant_tables
     SET status = 'co_khach', locked_by = NULL, locked_until = NULL, current_reservation_id = NULL
     WHERE id = ? AND status = 'trong'`,
    [id]
  );
}

// Trả bàn về trống thủ công — dùng khi khách đã về/rời đi.
// Chặn nếu bill còn mở VÀ còn món (chưa thanh toán) — phải nhờ thu_ngan thanh
// toán trước (Phase 7), tránh phuc_vu lách qua bước thu tiền.
// Nếu bill mở nhưng rỗng (chưa gọi món gì) -> tự đóng bill rỗng, tránh để sót
// khiến khách tiếp theo ngồi vào bàn này bị dính nhầm bill cũ.
async function releaseTable(id) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [tableRows] = await conn.query(
      `SELECT status FROM restaurant_tables WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (tableRows.length === 0 || tableRows[0].status !== 'co_khach') {
      await conn.rollback();
      return { affectedRows: 0 };
    }

    const [billRows] = await conn.query(
      `SELECT b.id, COUNT(bi.id) AS item_count
       FROM bills b
       LEFT JOIN bill_items bi ON bi.bill_id = b.id AND bi.deleted_at IS NULL
       WHERE b.table_id = ? AND b.status = 'mo'
       GROUP BY b.id`,
      [id]
    );

    if (billRows.length > 0 && billRows[0].item_count > 0) {
      const err = new Error('Bàn còn bill chưa thanh toán. Nhờ thu ngân thanh toán trước khi trả bàn.');
      err.status = 409;
      throw err;
    }

    if (billRows.length > 0) {
      await conn.query(
        `UPDATE bills SET status = 'da_thanh_toan', paid_at = NOW() WHERE id = ?`,
        [billRows[0].id]
      );
    }

    const [result] = await conn.query(
      `UPDATE restaurant_tables
       SET status = 'trong', current_reservation_id = NULL
       WHERE id = ? AND status = 'co_khach'`,
      [id]
    );

    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { findAll, findById, create, update, findStatusById, remove, assignWalkIn, releaseTable };
