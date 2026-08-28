
const { pool } = require('../config/db');
const dishModel = require('../models/dish.model');

async function getExcludedIngredientIds(userId) {
  return dishModel.findExcludedIngredientIds(userId);
}

async function list(req, res, next) {
  try {
    const { category, available_only } = req.query;
    const userId = req.user ? req.user.id : null;

    const [rows] = await dishModel.findAll(category, available_only === 'true');
    res.json({ dishes: rows });
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user ? req.user.id : null;

    const { dishResult, ingredientResult } = await dishModel.findById(id);
    const [dishRows] = dishResult;
    if (dishRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy món ăn.' });
    }
    const dish = dishRows[0];

    const [ingredientRows] = ingredientResult;
    dish.ingredients = ingredientRows;

    if (userId) {
      const excludedIds = await getExcludedIngredientIds(userId);
      const hasExcluded = ingredientRows.some((ing) => excludedIds.includes(ing.id));
      dish.contains_excluded_ingredient = hasExcluded;
    }

    res.json({ dish });
  } catch (err) {
    next(err);
  }
}

function uploadImage(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: 'Vui lòng chọn một file hình ảnh hợp lệ.' });
  }
  return res.status(201).json({ image_url: `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}` });
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { name, description, price, category, image_url, ingredient_ids } = req.body;

    if (!name || price === undefined || price === null) {
      return res.status(400).json({ message: 'Thiếu name hoặc price.' });
    }
    if (isNaN(price) || Number(price) < 0) {
      return res.status(400).json({ message: 'price không hợp lệ.' });
    }

    await conn.beginTransaction();

    const result = await dishModel.create(conn, {
      name, description: description || null, price, category: category || null,
      image_url: image_url || null, ingredient_ids: Array.isArray(ingredient_ids) ? ingredient_ids : [],
    });
    const dishId = result.insertId;

    await conn.commit();
    res.status(201).json({ id: dishId, name, price, category, image_url, ingredient_ids: ingredient_ids || [] });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

async function update(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { name, description, price, category, image_url, ingredient_ids } = req.body;

    if (!name || price === undefined || price === null) {
      return res.status(400).json({ message: 'Thiếu name hoặc price.' });
    }
    if (isNaN(price) || Number(price) < 0) {
      return res.status(400).json({ message: 'price không hợp lệ.' });
    }

    await conn.beginTransaction();

    const result = await dishModel.update(conn, id, {
      name, description: description || null, price, category: category || null,
      image_url: image_url || null, ingredient_ids,
    });

    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Không tìm thấy món ăn.' });
    }

    await conn.commit();
    res.json({ message: 'Đã cập nhật món ăn.' });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

async function toggleAvailability(req, res, next) {
  try {
    const { id } = req.params;
    const { is_available } = req.body;

    if (typeof is_available !== 'boolean') {
      return res.status(400).json({ message: 'is_available phải là true/false.' });
    }

    const [result] = await dishModel.setAvailability(id, is_available);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Không tìm thấy món ăn.' });
    }
    res.json({ id: Number(id), is_available });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [result] = await dishModel.remove(id);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Không tìm thấy món ăn.' });
    }
    res.json({ message: 'Đã xoá món ăn.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getById, uploadImage, create, update, toggleAvailability, remove };
