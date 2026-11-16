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

async function findAllTags() {
  const [rows] = await pool.query(
    'SELECT id, name, slug, sort_order FROM dish_tags ORDER BY sort_order, name'
  );
  return rows;
}

async function findTagsForDishIds(dishIds) {
  if (!dishIds.length) return {};
  const [rows] = await pool.query(
    `SELECT dtm.dish_id, dt.id, dt.name, dt.slug
     FROM dish_tag_map dtm
     JOIN dish_tags dt ON dt.id = dtm.tag_id
     WHERE dtm.dish_id IN (?)
     ORDER BY dt.sort_order, dt.name`,
    [dishIds]
  );

  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.dish_id]) grouped[row.dish_id] = [];
    grouped[row.dish_id].push({ id: Number(row.id), name: row.name, slug: row.slug });
  }
  return grouped;
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
    `SELECT i.id, i.name, di.quantity_g FROM ingredients i
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
  const tagResult = await pool.query(
    `SELECT dt.id, dt.name, dt.slug
     FROM dish_tag_map dtm
     JOIN dish_tags dt ON dt.id = dtm.tag_id
     WHERE dtm.dish_id = ?
     ORDER BY dt.sort_order, dt.name`,
    [id]
  );
  return { dishResult, ingredientResult, imageResult, tagResult };
}

async function findPublicReviewsByDishId(dishId) {
  const [dishRows] = await pool.query('SELECT id FROM dishes WHERE id = ?', [dishId]);
  if (dishRows.length === 0) return null;

  const [summaryRows] = await pool.query(
    `SELECT COUNT(DISTINCT bri.id) AS review_count,
            SUM(CASE WHEN bri.sentiment = 'like' THEN 1 ELSE 0 END) AS like_count,
            SUM(CASE WHEN bri.sentiment = 'dislike' THEN 1 ELSE 0 END) AS dislike_count
     FROM bill_review_items bri
     JOIN bill_items bi ON bi.id = bri.bill_item_id
     JOIN bill_reviews br ON br.id = bri.bill_review_id
     JOIN bills b ON b.id = br.bill_id AND b.status = 'da_thanh_toan'
     JOIN reservations r ON r.id = b.reservation_id AND r.user_id = br.user_id
     WHERE bi.dish_id = ? AND bi.deleted_at IS NULL`,
    [dishId]
  );
  const [reviews] = await pool.query(
    `SELECT br.id, bri.id AS feedback_id, br.comment, br.created_at, bri.sentiment,
            br.manager_reply, br.replied_at, manager.full_name AS manager_name
     FROM bill_review_items bri
     JOIN bill_items bi ON bi.id = bri.bill_item_id
     JOIN bill_reviews br ON br.id = bri.bill_review_id
     JOIN bills b ON b.id = br.bill_id AND b.status = 'da_thanh_toan'
     JOIN reservations r ON r.id = b.reservation_id AND r.user_id = br.user_id
     LEFT JOIN users manager ON manager.id = br.replied_by
     WHERE bi.dish_id = ? AND bi.deleted_at IS NULL
     ORDER BY br.created_at DESC, br.id DESC
     LIMIT 30`,
    [dishId]
  );

  return {
    summary: {
      review_count: Number(summaryRows[0].review_count),
      like_count: Number(summaryRows[0].like_count || 0),
      dislike_count: Number(summaryRows[0].dislike_count || 0),
    },
    reviews: reviews.map((review) => ({
      ...review,
    })),
  };
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

async function syncIngredients(connection, dishId, ingredients) {
  const [existingRows] = await connection.query(
    'SELECT ingredient_id, quantity_g FROM dish_ingredients WHERE dish_id = ?',
    [dishId]
  );
  const existingQuantities = new Map(
    existingRows.map((row) => [Number(row.ingredient_id), row.quantity_g])
  );

  await connection.query('DELETE FROM dish_ingredients WHERE dish_id = ?', [dishId]);
  if (ingredients.length > 0) {
    const values = ingredients.map((ingredient) => {
      const ingredientId = Number(ingredient.ingredient_id);
      const quantity = ingredient.quantity_g === undefined
        ? existingQuantities.get(ingredientId) ?? null
        : ingredient.quantity_g;
      return [dishId, ingredientId, quantity];
    });
    await connection.query(
      'INSERT INTO dish_ingredients (dish_id, ingredient_id, quantity_g) VALUES ?',
      [values]
    );
  }
}

async function syncTags(connection, dishId, tagIds) {
  const normalizedIds = [...new Set(tagIds
    .map((tagId) => Number(tagId))
    .filter((tagId) => Number.isInteger(tagId) && tagId > 0))];

  await connection.query('DELETE FROM dish_tag_map WHERE dish_id = ?', [dishId]);
  if (normalizedIds.length > 0) {
    const values = normalizedIds.map((tagId) => [dishId, tagId]);
    await connection.query(
      'INSERT INTO dish_tag_map (dish_id, tag_id) VALUES ?',
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
  await syncIngredients(connection, result.insertId, dish.ingredients);
  if (Array.isArray(dish.tagIds)) await syncTags(connection, result.insertId, dish.tagIds);
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
  if (Array.isArray(dish.ingredients)) await syncIngredients(connection, id, dish.ingredients);
  if (Array.isArray(dish.tagIds)) await syncTags(connection, id, dish.tagIds);
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
  findAllTags,
  findTagsForDishIds,
  findById,
  findPublicReviewsByDishId,
  syncImages,
  syncTags,
  create,
  update,
  setAvailability,
  remove,
};
