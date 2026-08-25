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

module.exports = { findAll, findById, create, update, findStatusById, remove };
