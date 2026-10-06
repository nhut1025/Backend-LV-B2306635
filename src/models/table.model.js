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

// Trả bàn về trống thủ công: chỉ cho phép từ co_khach.
async function releaseTable(id) {
  return pool.query(
    `UPDATE restaurant_tables
     SET status = 'trong', locked_by = NULL, locked_until = NULL, current_reservation_id = NULL
     WHERE id = ? AND status = 'co_khach'`,
    [id]
  );
}

module.exports = { findAll, findById, create, update, findStatusById, remove, assignWalkIn, releaseTable };
