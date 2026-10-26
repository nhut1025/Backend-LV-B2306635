
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
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ message: 'Thiếu tên nguyên liệu.' });
  if (name.length > 120) return res.status(400).json({ message: 'Tên nguyên liệu không được vượt quá 120 ký tự.' });

  try {
    const [existing] = await ingredientModel.findByName(name);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Nguyên liệu này đã tồn tại.' });
    }

    const [result] = await ingredientModel.create(name);
    res.status(201).json({ id: result.insertId, name });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Nguyên liệu này đã tồn tại.' });
    }
    next(err);
  }
}

async function update(req, res, next) {
  const { id } = req.params;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!/^\d+$/.test(id) || Number(id) < 1) return res.status(400).json({ message: 'ID nguyên liệu không hợp lệ.' });
  if (!name) return res.status(400).json({ message: 'Thiếu tên nguyên liệu.' });
  if (name.length > 120) return res.status(400).json({ message: 'Tên nguyên liệu không được vượt quá 120 ký tự.' });

  try {
    const [result] = await ingredientModel.update(id, name);
    if (result.affectedRows === 0) {
      const [existing] = await ingredientModel.findById(id);
      if (!existing.length) return res.status(404).json({ message: 'Không tìm thấy nguyên liệu.' });
    }
    res.json({ id: Number(id), name });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Nguyên liệu này đã tồn tại.' });
    }
    next(err);
  }
}

async function remove(req, res, next) {
  const { id } = req.params;
  if (!/^\d+$/.test(id) || Number(id) < 1) return res.status(400).json({ message: 'ID nguyên liệu không hợp lệ.' });
  try {
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
