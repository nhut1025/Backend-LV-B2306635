
const { pool } = require('../config/db');
const dishModel = require('../models/dish.model');
const categoryModel = require('../models/category.model');

async function getExcludedIngredientIds(userId) {
  return dishModel.findExcludedIngredientIds(userId);
}

async function list(req, res, next) {
  try {
    const { category, category_id, available_only } = req.query;
    if (category_id !== undefined && (!/^\d+$/.test(String(category_id)) || Number(category_id) < 1)) {
      return res.status(400).json({ message: 'category_id không hợp lệ.' });
    }

    const [rows] = await dishModel.findAll(category, category_id, available_only === 'true');
    res.json({ dishes: rows });
  } catch (err) {
    next(err);
  }
}

async function resolveCategory(categoryId, categoryName) {
  if (categoryId !== undefined && categoryId !== null && categoryId !== '') {
    if (!/^\d+$/.test(String(categoryId)) || Number(categoryId) < 1) {
      return { error: 'category_id không hợp lệ.' };
    }
    const [rows] = await categoryModel.findById(categoryId);
    if (!rows.length) return { error: 'Danh mục không tồn tại.' };
    return { category: rows[0] };
  }

  if (typeof categoryName === 'string' && categoryName.trim()) {
    const [rows] = await categoryModel.findByName(categoryName.trim());
    if (!rows.length) return { error: 'Danh mục không tồn tại. Hãy chọn một danh mục đã được tạo.' };
    return { category: rows[0] };
  }

  return { category: null };
}

function resolveImageUrls(imageUrls, legacyImageUrl) {
  if (imageUrls !== undefined && !Array.isArray(imageUrls)) {
    return { error: 'image_urls phải là một danh sách URL.' };
  }

  const rawUrls = imageUrls === undefined
    ? (legacyImageUrl ? [legacyImageUrl] : [])
    : imageUrls;
  if (rawUrls.length > 10) {
    return { error: 'Mỗi món chỉ được có tối đa 10 hình ảnh.' };
  }
  if (rawUrls.some((url) => typeof url !== 'string' || !url.trim() || url.trim().length > 500)) {
    return { error: 'Mỗi URL hình ảnh phải là chuỗi hợp lệ, không rỗng và tối đa 500 ký tự.' };
  }
  return { imageUrls: [...new Set(rawUrls.map((url) => url.trim()))] };
}

async function getById(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user ? req.user.id : null;

    const { dishResult, ingredientResult, imageResult } = await dishModel.findById(id);
    const [dishRows] = dishResult;
    if (dishRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy món ăn.' });
    }
    const dish = dishRows[0];

    const [ingredientRows] = ingredientResult;
    const [imageRows] = imageResult;
    dish.ingredients = ingredientRows;
    dish.images = imageRows.map((image) => image.image_url);
    if (dish.images.length === 0 && dish.image_url) dish.images = [dish.image_url];
    dish.contains_excluded_ingredient = false;

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
    const { name, description, price, category, category_id, image_url, image_urls, ingredient_ids } = req.body;

    if (!name || price === undefined || price === null) {
      return res.status(400).json({ message: 'Thiếu name hoặc price.' });
    }
    if (isNaN(price) || Number(price) < 0) {
      return res.status(400).json({ message: 'price không hợp lệ.' });
    }

    const categoryResult = await resolveCategory(category_id, category);
    if (categoryResult.error) return res.status(400).json({ message: categoryResult.error });
    const resolvedCategory = categoryResult.category;
    const imageResult = resolveImageUrls(image_urls, image_url);
    if (imageResult.error) return res.status(400).json({ message: imageResult.error });

    await conn.beginTransaction();

    const result = await dishModel.create(conn, {
      name, description: description || null, price,
      categoryId: resolvedCategory?.id || null, categoryName: resolvedCategory?.name || null,
      imageUrls: imageResult.imageUrls, ingredient_ids: Array.isArray(ingredient_ids) ? ingredient_ids : [],
    });
    const dishId = result.insertId;

    await conn.commit();
    res.status(201).json({
      id: dishId, name, price, category_id: resolvedCategory?.id || null,
      category: resolvedCategory?.name || null,
      image_url: imageResult.imageUrls[0] || null, images: imageResult.imageUrls,
      ingredient_ids: ingredient_ids || [],
    });
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
    const { name, description, price, category, category_id, image_url, image_urls, ingredient_ids } = req.body;

    if (!name || price === undefined || price === null) {
      return res.status(400).json({ message: 'Thiếu name hoặc price.' });
    }
    if (isNaN(price) || Number(price) < 0) {
      return res.status(400).json({ message: 'price không hợp lệ.' });
    }

    const categoryResult = await resolveCategory(category_id, category);
    if (categoryResult.error) return res.status(400).json({ message: categoryResult.error });
    const resolvedCategory = categoryResult.category;
    const imageResult = resolveImageUrls(image_urls, image_url);
    if (imageResult.error) return res.status(400).json({ message: imageResult.error });

    await conn.beginTransaction();

    const result = await dishModel.update(conn, id, {
      name, description: description || null, price,
      categoryId: resolvedCategory?.id || null, categoryName: resolvedCategory?.name || null,
      imageUrls: imageResult.imageUrls, ingredient_ids,
    });

    if (result.matchedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Không tìm thấy món ăn.' });
    }

    await conn.commit();
    res.json({
      message: 'Đã cập nhật món ăn.',
      image_url: imageResult.imageUrls[0] || null,
      images: imageResult.imageUrls,
    });
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
