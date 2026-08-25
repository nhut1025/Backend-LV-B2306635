const { pool } = require('../config/db');

async function findAll() {
  return pool.query('SELECT id, name FROM ingredients ORDER BY name ASC');
}

async function findByName(name) {
  return pool.query('SELECT id FROM ingredients WHERE name = ?', [name]);
}

async function create(name) {
  return pool.query('INSERT INTO ingredients (name) VALUES (?)', [name]);
}

async function update(id, name) {
  return pool.query('UPDATE ingredients SET name = ? WHERE id = ?', [name, id]);
}

async function remove(id) {
  return pool.query('DELETE FROM ingredients WHERE id = ?', [id]);
}

module.exports = { findAll, findByName, create, update, remove };
