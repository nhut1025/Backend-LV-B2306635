const { pool } = require('../config/db');

async function findExcludedIngredientIds(userId) {
  if (!userId) return [];
  const [rows] = await pool.query(
    'SELECT ingredient_id FROM user_excluded_ingredients WHERE user_id = ?',
    [userId]
  );
  return rows.map((row) => row.ingredient_id);
}

async function findAll(category, availableOnly, excludedIds) {
  let sql = 'SELECT id, name, description, price, category, image_url, is_available FROM dishes WHERE 1=1';
  const params = [];
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (availableOnly) sql += ' AND is_available = TRUE';
  if (excludedIds.length > 0) {
    sql += ` AND id NOT IN (SELECT dish_id FROM dish_ingredients WHERE ingredient_id IN (${excludedIds.map(() => '?').join(',')}))`;
    params.push(...excludedIds);
  }
  sql += ' ORDER BY category, name';
  return pool.query(sql, params);
}

async function findById(id) {
  const dishResult = await pool.query('SELECT * FROM dishes WHERE id = ?', [id]);
  const ingredientResult = await pool.query(
    `SELECT i.id, i.name FROM ingredients i
     JOIN dish_ingredients di ON di.ingredient_id = i.id
     WHERE di.dish_id = ?`,
    [id]
  );
  return { dishResult, ingredientResult };
}

async function create(connection, dish) {
  const [result] = await connection.query(
    `INSERT INTO dishes (name, description, price, category, image_url)
     VALUES (?, ?, ?, ?, ?)`,
    [dish.name, dish.description, dish.price, dish.category, dish.image_url]
  );
  if (dish.ingredient_ids.length > 0) {
    const values = dish.ingredient_ids.map((ingredientId) => [result.insertId, ingredientId]);
    await connection.query('INSERT INTO dish_ingredients (dish_id, ingredient_id) VALUES ?', [values]);
  }
  return result;
}

async function update(connection, id, dish) {
  const [result] = await connection.query(
    `UPDATE dishes SET name = ?, description = ?, price = ?, category = ?, image_url = ? WHERE id = ?`,
    [dish.name, dish.description, dish.price, dish.category, dish.image_url, id]
  );
  if (Array.isArray(dish.ingredient_ids)) {
    await connection.query('DELETE FROM dish_ingredients WHERE dish_id = ?', [id]);
    if (dish.ingredient_ids.length > 0) {
      const values = dish.ingredient_ids.map((ingredientId) => [id, ingredientId]);
      await connection.query('INSERT INTO dish_ingredients (dish_id, ingredient_id) VALUES ?', [values]);
    }
  }
  return result;
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
  create,
  update,
  setAvailability,
  remove,
};
