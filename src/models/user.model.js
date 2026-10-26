const { pool } = require('../config/db');

async function findProfileById(id) {
  return pool.query(
    `SELECT id, full_name, email, phone, role, avatar_url, created_at, is_verified,
            google_id IS NOT NULL AS is_google_account
     FROM users WHERE id = ?`,
    [id]
  );
}

async function updateProfile(id, fullName, phone) {
  return pool.query(
    'UPDATE users SET full_name = ?, phone = ? WHERE id = ?',
    [fullName, phone, id]
  );
}

async function updateAvatar(id, avatarUrl) {
  return pool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, id]);
}

async function findPasswordCredentialsById(id) {
  return pool.query(
    'SELECT password_hash, google_id FROM users WHERE id = ?',
    [id]
  );
}

async function updatePassword(id, passwordHash) {
  return pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
}

async function findReservationSummary(userId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS reservation_count, MAX(created_at) AS last_reservation_at
     FROM reservations
     WHERE user_id = ?`,
    [userId]
  );
  return rows[0];
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
  updateAvatar,
  findPasswordCredentialsById,
  updatePassword,
  findReservationSummary,
  findExcludedIngredients,
  findExcludedIngredientIds,
  replaceExcludedIngredients,
};
