const { pool } = require('../config/db');

const ALLOWED_MODELS = new Set(['popularity', 'content_based']);

async function listGlobalRecommendations(modelName, limit, userId = null) {
  if (!ALLOWED_MODELS.has(modelName)) {
    const error = new Error('Mô hình gợi ý không hợp lệ.');
    error.status = 400;
    throw error;
  }

  const excludedIngredientsFilter = userId === null
    ? ''
    : `AND NOT EXISTS (
         SELECT 1
         FROM dish_ingredients di
         JOIN user_excluded_ingredients uei
           ON uei.ingredient_id = di.ingredient_id
         WHERE di.dish_id = d.id AND uei.user_id = ?
       )`;
  const params = userId === null
    ? [modelName, limit]
    : [modelName, userId, limit];
  const [rows] = await pool.query(
    `SELECT dr.model_name, dr.dish_id, dr.score, dr.rank_order,
            d.name, d.description, d.price, d.category_id,
            COALESCE(c.name, d.category) AS category, d.image_url
     FROM dish_recommendations dr
     JOIN dishes d ON d.id = dr.dish_id
     LEFT JOIN dish_categories c ON c.id = d.category_id
     WHERE dr.user_id IS NULL
       AND dr.model_name = ?
       AND d.is_available = TRUE
       ${excludedIngredientsFilter}
     ORDER BY dr.rank_order ASC, dr.dish_id ASC
     LIMIT ?`,
    params
  );
  return rows;
}

async function listUserRecommendations(userId, modelName, limit) {
  if (!ALLOWED_MODELS.has(modelName)) {
    const error = new Error('Mô hình gợi ý không hợp lệ.');
    error.status = 400;
    throw error;
  }

  const [rows] = await pool.query(
    `SELECT dr.model_name, dr.dish_id, dr.score, dr.rank_order,
            d.name, d.description, d.price, d.category_id,
            COALESCE(c.name, d.category) AS category, d.image_url
     FROM dish_recommendations dr
     JOIN dishes d ON d.id = dr.dish_id
     LEFT JOIN dish_categories c ON c.id = d.category_id
     WHERE dr.user_id = ?
       AND dr.model_name = ?
       AND d.is_available = TRUE
       AND NOT EXISTS (
         SELECT 1
         FROM dish_ingredients di
         JOIN user_excluded_ingredients uei
           ON uei.ingredient_id = di.ingredient_id
         WHERE di.dish_id = d.id AND uei.user_id = dr.user_id
       )
     ORDER BY dr.rank_order ASC, dr.dish_id ASC
     LIMIT ?`,
    [userId, modelName, limit]
  );
  return rows;
}

module.exports = {
  listGlobalRecommendations,
  listUserRecommendations,
  ALLOWED_MODELS,
};
