const { pool } = require('../config/db');

async function findExcludedIngredientIds(userId) {
  if (!userId) return [];
  const [rows] = await pool.query(
    'SELECT ingredient_id FROM user_excluded_ingredients WHERE user_id = ?',
    [userId]
  );
  return rows.map((row) => row.ingredient_id);
}

function findAll(category, categoryId, availableOnly) {
  let sql = `SELECT d.id, d.name, d.description, d.price, d.category_id,
                    COALESCE(c.name, d.category) AS category, d.image_url, d.is_available
             FROM dishes d
             LEFT JOIN dish_categories c ON c.id = d.category_id
             WHERE 1=1`;
  const params = [];
  if (categoryId) {
    sql += ' AND d.category_id = ?';
    params.push(categoryId);
  }
  if (category) {
    sql += ' AND COALESCE(c.name, d.category) = ?';
    params.push(category);
  }
  if (availableOnly) sql += ' AND d.is_available = TRUE';
  sql += ' ORDER BY category, d.name';
  return pool.query(sql, params);
}

async function findById(id) {
  const dishResult = await pool.query(
    `SELECT d.id, d.name, d.description, d.price, d.category_id,
            COALESCE(c.name, d.category) AS category, d.image_url, d.is_available,
            d.created_at, d.updated_at
     FROM dishes d
     LEFT JOIN dish_categories c ON c.id = d.category_id
     WHERE d.id = ?`,
    [id]
  );
  const ingredientResult = await pool.query(
    `SELECT i.id, i.name FROM ingredients i
     JOIN dish_ingredients di ON di.ingredient_id = i.id
     JOIN dishes d ON d.id = di.dish_id
     WHERE d.id = ?`,
    [id]
  );
  const imageResult = await pool.query(
    `SELECT id, image_url, sort_order
     FROM dish_images
     WHERE dish_id = ?
     ORDER BY sort_order, id`,
    [id]
  );
  return { dishResult, ingredientResult, imageResult };
}

async function syncImages(connection, dishId, imageUrls) {
  await connection.query('DELETE FROM dish_images WHERE dish_id = ?', [dishId]);
  if (imageUrls.length > 0) {
    const values = imageUrls.map((imageUrl, index) => [dishId, imageUrl, index]);
    await connection.query(
      'INSERT INTO dish_images (dish_id, image_url, sort_order) VALUES ?',
      [values]
    );
  }
}

async function create(connection, dish) {
  const [result] = await connection.query(
    `INSERT INTO dishes (name, description, price, category, category_id, image_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      dish.name, dish.description, dish.price, dish.categoryName, dish.categoryId,
      dish.imageUrls[0] || null,
    ]
  );
  await syncImages(connection, result.insertId, dish.imageUrls);
  if (dish.ingredient_ids.length > 0) {
    const values = dish.ingredient_ids.map((ingredientId) => [result.insertId, ingredientId]);
    await connection.query('INSERT INTO dish_ingredients (dish_id, ingredient_id) VALUES ?', [values]);
  }
  return result;
}

async function update(connection, id, dish) {
  const [existingRows] = await connection.query(
    'SELECT id FROM dishes WHERE id = ? FOR UPDATE',
    [id]
  );
  if (existingRows.length === 0) return { affectedRows: 0, matchedRows: 0 };

  const [result] = await connection.query(
    `UPDATE dishes SET name = ?, description = ?, price = ?, category = ?, category_id = ?, image_url = ? WHERE id = ?`,
    [
      dish.name, dish.description, dish.price, dish.categoryName, dish.categoryId,
      dish.imageUrls[0] || null, id,
    ]
  );
  await syncImages(connection, id, dish.imageUrls);
  if (Array.isArray(dish.ingredient_ids)) {
    await connection.query('DELETE FROM dish_ingredients WHERE dish_id = ?', [id]);
    if (dish.ingredient_ids.length > 0) {
      const values = dish.ingredient_ids.map((ingredientId) => [id, ingredientId]);
      await connection.query('INSERT INTO dish_ingredients (dish_id, ingredient_id) VALUES ?', [values]);
    }
  }
  return { ...result, matchedRows: existingRows.length };
}

async function setAvailability(id, isAvailable) {
  return pool.query('UPDATE dishes SET is_available = ? WHERE id = ?', [isAvailable, id]);
}

async function remove(id) {
  return pool.query('DELETE FROM dishes WHERE id = ?', [id]);
}

module.exports = {
  findExcludedIngredientIds,
  findAll,
  findById,
  syncImages,
  create,
  update,
  setAvailability,
  remove,
};
