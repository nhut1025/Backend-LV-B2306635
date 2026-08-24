
const { pool } = require('../config/db');
const { getCapacityRange } = require('../utils/settings');

async function list(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT id, table_number, capacity, status FROM restaurant_tables ORDER BY table_number'
    );
    res.json({ tables: rows });
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM restaurant_tables WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy bàn.' });
    }
    res.json({ table: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { table_number, capacity } = req.body;

    if (!table_number || capacity === undefined || capacity === null) {
      return res.status(400).json({ message: 'Thiếu table_number hoặc capacity.' });
    }

    const { min, max } = await getCapacityRange();
    if (Number(capacity) < min || Number(capacity) > max) {
      return res.status(400).json({ message: `capacity phải nằm trong khoảng [${min}, ${max}].` });
    }

    const [result] = await pool.query(
      `INSERT INTO restaurant_tables (table_number, capacity, status) VALUES (?, ?, 'trong')`,
      [table_number, capacity]
    );

    res.status(201).json({ id: result.insertId, table_number, capacity, status: 'trong' });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { table_number, capacity } = req.body;

    if (!table_number || capacity === undefined || capacity === null) {
      return res.status(400).json({ message: 'Thiếu table_number hoặc capacity.' });
    }

    const { min, max } = await getCapacityRange();
    if (Number(capacity) < min || Number(capacity) > max) {
      return res.status(400).json({ message: `capacity phải nằm trong khoảng [${min}, ${max}].` });
    }

    const [result] = await pool.query(
      'UPDATE restaurant_tables SET table_number = ?, capacity = ? WHERE id = ?',
      [table_number, capacity, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Không tìm thấy bàn.' });
    }
    res.json({ id: Number(id), table_number, capacity });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;

    const [rows] = await pool.query('SELECT status FROM restaurant_tables WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy bàn.' });
    }
    if (rows[0].status !== 'trong') {
      return res.status(409).json({ message: 'Chỉ có thể xoá bàn đang ở trạng thái "trong".' });
    }

    await pool.query('DELETE FROM restaurant_tables WHERE id = ?', [id]);
    res.json({ message: 'Đã xoá bàn.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getById, create, update, remove };
