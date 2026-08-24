
const { pool } = require('../config/db');

async function getProfile(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT id, full_name, email, phone, role, avatar_url, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy user.' });
    }
    res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const { full_name, phone, avatar_url } = req.body;

    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ message: 'Thiếu full_name.' });
    }

    await pool.query(
      'UPDATE users SET full_name = ?, phone = ?, avatar_url = ? WHERE id = ?',
      [full_name.trim(), phone || null, avatar_url || null, req.user.id]
    );

    res.json({ message: 'Đã cập nhật hồ sơ.' });
  } catch (err) {
    next(err);
  }
}

async function getExcludedIngredients(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT i.id, i.name FROM ingredients i
       JOIN user_excluded_ingredients uei ON uei.ingredient_id = i.id
       WHERE uei.user_id = ?
       ORDER BY i.name`,
      [req.user.id]
    );
    res.json({ excluded_ingredients: rows });
  } catch (err) {
    next(err);
  }
}

async function setExcludedIngredients(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { ingredient_ids } = req.body;
    if (!Array.isArray(ingredient_ids)) {
      return res.status(400).json({ message: 'ingredient_ids phải là 1 mảng (có thể rỗng).' });
    }

    await conn.beginTransaction();
    await conn.query('DELETE FROM user_excluded_ingredients WHERE user_id = ?', [req.user.id]);

    if (ingredient_ids.length > 0) {
      const values = ingredient_ids.map((ingId) => [req.user.id, ingId]);
      await conn.query(
        'INSERT INTO user_excluded_ingredients (user_id, ingredient_id) VALUES ?',
        [values]
      );
    }

    await conn.commit();
    res.json({ message: 'Đã cập nhật danh sách nguyên liệu loại trừ.', ingredient_ids });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = { getProfile, updateProfile, getExcludedIngredients, setExcludedIngredients };
