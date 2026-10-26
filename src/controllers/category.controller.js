const categoryModel = require('../models/category.model');

function validId(id) {
  return /^\d+$/.test(String(id)) && Number(id) > 0;
}

function duplicateNameError(err) {
  return err.code === 'ER_DUP_ENTRY';
}

async function list(req, res, next) {
  try {
    const [rows] = await categoryModel.findAll();
    res.json({ categories: rows });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ message: 'Thiếu tên danh mục.' });
  if (name.length > 100) return res.status(400).json({ message: 'Tên danh mục không được vượt quá 100 ký tự.' });

  try {
    const [result] = await categoryModel.create(name);
    res.status(201).json({ category: { id: result.insertId, name, dish_count: 0 } });
  } catch (err) {
    if (duplicateNameError(err)) {
      return res.status(409).json({ message: 'Danh mục này đã tồn tại.' });
    }
    next(err);
  }
}

async function update(req, res, next) {
  const { id } = req.params;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!validId(id)) return res.status(400).json({ message: 'ID danh mục không hợp lệ.' });
  if (!name) return res.status(400).json({ message: 'Thiếu tên danh mục.' });
  if (name.length > 100) return res.status(400).json({ message: 'Tên danh mục không được vượt quá 100 ký tự.' });

  try {
    const [result] = await categoryModel.update(id, name);
    if (result.affectedRows === 0) {
      const [existing] = await categoryModel.findById(id);
      if (!existing.length) return res.status(404).json({ message: 'Không tìm thấy danh mục.' });
    }
    res.json({ category: { id: Number(id), name } });
  } catch (err) {
    if (duplicateNameError(err)) {
      return res.status(409).json({ message: 'Danh mục này đã tồn tại.' });
    }
    next(err);
  }
}

async function remove(req, res, next) {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).json({ message: 'ID danh mục không hợp lệ.' });

  try {
    const [existing] = await categoryModel.findById(id);
    if (!existing.length) return res.status(404).json({ message: 'Không tìm thấy danh mục.' });

    const assignedDishes = await categoryModel.countAssignedDishes(id);
    if (assignedDishes > 0) {
      return res.status(409).json({
        message: `Không thể xoá danh mục đang được gán cho ${assignedDishes} món ăn. Hãy chuyển các món sang danh mục khác trước.`,
      });
    }

    await categoryModel.remove(id);
    res.json({ message: 'Đã xoá danh mục.' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ message: 'Không thể xoá danh mục đang được sử dụng bởi món ăn.' });
    }
    next(err);
  }
}

module.exports = { list, create, update, remove };
