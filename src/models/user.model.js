const { pool } = require('../config/db');

async function findProfileById(id) {
  return pool.query(
    'SELECT id, full_name, email, phone, role, avatar_url, created_at FROM users WHERE id = ?',
    [id]
  );
}

async function updateProfile(id, fullName, phone, avatarUrl) {
  return pool.query(
    'UPDATE users SET full_name = ?, phone = ?, avatar_url = ? WHERE id = ?',
    [fullName, phone, avatarUrl, id]
  );
}

async function findExcludedIngredients(id) {
  return pool.query(
    `SELECT i.id, i.name FROM ingredients i
     JOIN user_excluded_ingredients uei ON uei.ingredient_id = i.id
     WHERE uei.user_id = ?
     ORDER BY i.name`,
    [id]
  );
}

async function findExcludedIngredientIds(id) {
  const [rows] = await pool.query(
    'SELECT ingredient_id FROM user_excluded_ingredients WHERE user_id = ?',
    [id]
  );
  return rows.map((row) => row.ingredient_id);
}

async function replaceExcludedIngredients(connection, userId, ingredientIds) {
  await connection.query('DELETE FROM user_excluded_ingredients WHERE user_id = ?', [userId]);
  if (ingredientIds.length > 0) {
    const values = ingredientIds.map((ingredientId) => [userId, ingredientId]);
    await connection.query(
      'INSERT INTO user_excluded_ingredients (user_id, ingredient_id) VALUES ?',
      [values]
    );
  }
}

module.exports = {
  findProfileById,
  updateProfile,
  findExcludedIngredients,
  findExcludedIngredientIds,
  replaceExcludedIngredients,
};
