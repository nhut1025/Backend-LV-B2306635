const { pool } = require('../config/db');

async function findAll() {
  return pool.query(
    `SELECT c.id, c.name, COUNT(d.id) AS dish_count
     FROM dish_categories c
     LEFT JOIN dishes d ON d.category_id = c.id
     GROUP BY c.id, c.name
     ORDER BY c.name ASC`
  );
}

async function findById(id) {
  return pool.query('SELECT id, name FROM dish_categories WHERE id = ?', [id]);
}

async function findByName(name) {
  return pool.query('SELECT id, name FROM dish_categories WHERE name = ?', [name]);
}

async function create(name) {
  return pool.query('INSERT INTO dish_categories (name) VALUES (?)', [name]);
}

async function update(id, name) {
  return pool.query('UPDATE dish_categories SET name = ? WHERE id = ?', [name, id]);
}

async function countAssignedDishes(id) {
  const [rows] = await pool.query('SELECT COUNT(*) AS count FROM dishes WHERE category_id = ?', [id]);
  return Number(rows[0].count);
}

async function remove(id) {
  return pool.query('DELETE FROM dish_categories WHERE id = ?', [id]);
}

module.exports = { findAll, findById, findByName, create, update, countAssignedDishes, remove };
