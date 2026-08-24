
const { pool } = require('../config/db');

async function getExcludedIngredientIds(userId) {
  if (!userId) return [];
  const [rows] = await pool.query(
    'SELECT ingredient_id FROM user_excluded_ingredients WHERE user_id = ?',
    [userId]
  );
  return rows.map((r) => r.ingredient_id);
}

async function list(req, res, next) {
  try {
    const { category, available_only } = req.query;
    const userId = req.user ? req.user.id : null;
    const excludedIds = await getExcludedIngredientIds(userId);

    let sql = 'SELECT id, name, description, price, category, image_url, is_available FROM dishes WHERE 1=1';
    const params = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (available_only === 'true') {
      sql += ' AND is_available = TRUE';
    }
    if (excludedIds.length > 0) {
      sql += ` AND id NOT IN (
        SELECT dish_id FROM dish_ingredients WHERE ingredient_id IN (${excludedIds.map(() => '?').join(',')})
      )`;
      params.push(...excludedIds);
    }

    sql += ' ORDER BY category, name';

    const [rows] = await pool.query(sql, params);
    res.json({ dishes: rows });
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user ? req.user.id : null;

    const [dishRows] = await pool.query('SELECT * FROM dishes WHERE id = ?', [id]);
    if (dishRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy món ăn.' });
    }
    const dish = dishRows[0];

    const [ingredientRows] = await pool.query(
      `SELECT i.id, i.name FROM ingredients i
       JOIN dish_ingredients di ON di.ingredient_id = i.id
       WHERE di.dish_id = ?`,
      [id]
    );
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

    const [result] = await conn.query(
      `INSERT INTO dishes (name, description, price, category, image_url)
       VALUES (?, ?, ?, ?, ?)`,
      [name, description || null, price, category || null, image_url || null]
    );
    const dishId = result.insertId;

    if (Array.isArray(ingredient_ids) && ingredient_ids.length > 0) {
      const values = ingredient_ids.map((ingId) => [dishId, ingId]);
      await conn.query('INSERT INTO dish_ingredients (dish_id, ingredient_id) VALUES ?', [values]);
    }

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

    await conn.beginTransaction();

    const [result] = await conn.query(
      `UPDATE dishes SET name = ?, description = ?, price = ?, category = ?, image_url = ?
       WHERE id = ?`,
      [name, description || null, price, category || null, image_url || null, id]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Không tìm thấy món ăn.' });
    }

    if (Array.isArray(ingredient_ids)) {
      await conn.query('DELETE FROM dish_ingredients WHERE dish_id = ?', [id]);
      if (ingredient_ids.length > 0) {
        const values = ingredient_ids.map((ingId) => [id, ingId]);
        await conn.query('INSERT INTO dish_ingredients (dish_id, ingredient_id) VALUES ?', [values]);
      }
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

    const [result] = await pool.query('UPDATE dishes SET is_available = ? WHERE id = ?', [is_available, id]);
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
    const [result] = await pool.query('DELETE FROM dishes WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Không tìm thấy món ăn.' });
    }
    res.json({ message: 'Đã xoá món ăn.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getById, create, update, toggleAvailability, remove };
