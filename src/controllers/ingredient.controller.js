
const { pool } = require('../config/db');

async function list(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT id, name FROM ingredients ORDER BY name ASC');
    res.json({ ingredients: rows });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Thiếu tên nguyên liệu.' });
    }

    const [existing] = await pool.query('SELECT id FROM ingredients WHERE name = ?', [name.trim()]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Nguyên liệu này đã tồn tại.' });
    }

    const [result] = await pool.query('INSERT INTO ingredients (name) VALUES (?)', [name.trim()]);
    res.status(201).json({ id: result.insertId, name: name.trim() });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Thiếu tên nguyên liệu.' });
    }

    const [result] = await pool.query('UPDATE ingredients SET name = ? WHERE id = ?', [name.trim(), id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Không tìm thấy nguyên liệu.' });
    }
    res.json({ id: Number(id), name: name.trim() });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [result] = await pool.query('DELETE FROM ingredients WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Không tìm thấy nguyên liệu.' });
    }
    res.json({ message: 'Đã xoá nguyên liệu.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
