
const { getCapacityRange } = require('../utils/settings');
const tableModel = require('../models/table.model');

async function list(req, res, next) {
  try {
    const rows = await tableModel.findAll();
    res.json({ tables: rows });
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const { id } = req.params;
    const rows = await tableModel.findById(id);
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

    const [result] = await tableModel.create(table_number, capacity);

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

    const [result] = await tableModel.update(id, table_number, capacity);

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

    const rows = await tableModel.findStatusById(id);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy bàn.' });
    }
    if (rows[0].status !== 'trong') {
      return res.status(409).json({ message: 'Chỉ có thể xoá bàn đang ở trạng thái "trong".' });
    }

    await tableModel.remove(id);
    res.json({ message: 'Đã xoá bàn.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getById, create, update, remove };
