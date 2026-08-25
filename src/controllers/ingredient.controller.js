
const ingredientModel = require('../models/ingredient.model');

async function list(req, res, next) {
  try {
    const [rows] = await ingredientModel.findAll();
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

    const [existing] = await ingredientModel.findByName(name.trim());
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Nguyên liệu này đã tồn tại.' });
    }

    const [result] = await ingredientModel.create(name.trim());
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

    const [result] = await ingredientModel.update(id, name.trim());
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
    const [result] = await ingredientModel.remove(id);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Không tìm thấy nguyên liệu.' });
    }
    res.json({ message: 'Đã xoá nguyên liệu.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
