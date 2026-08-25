
const { pool } = require('../config/db');
const userModel = require('../models/user.model');
const authModel = require('../models/auth.model');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

async function getProfile(req, res, next) {
  try {
    const [rows] = await userModel.findProfileById(req.user.id);
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

    await userModel.updateProfile(
      req.user.id,
      full_name.trim(),
      phone || null,
      avatar_url || null
    );

    res.json({ message: 'Đã cập nhật hồ sơ.' });
  } catch (err) {
    next(err);
  }
}

async function getExcludedIngredients(req, res, next) {
  try {
    const [rows] = await userModel.findExcludedIngredients(req.user.id);
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
    await userModel.replaceExcludedIngredients(conn, req.user.id, ingredient_ids);

    await conn.commit();
    res.json({ message: 'Đã cập nhật danh sách nguyên liệu loại trừ.', ingredient_ids });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

async function createStaff(req, res, next) {
  try {
    const { full_name, email, password, phone, role } = req.body;
    if (!full_name || !email || !password || !role) {
      return res.status(400).json({ message: 'Thiếu full_name, email, password hoặc role.' });
    }
    if (!['staff', 'kitchen'].includes(role)) {
      return res.status(400).json({ message: 'role chỉ có thể là staff hoặc kitchen.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password phải có ít nhất 6 ký tự.' });
    }

    const [existing] = await authModel.findByEmail(email);
    if (existing.length > 0) return res.status(409).json({ message: 'Email đã được sử dụng.' });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const [result] = await authModel.createInternalUser(
      full_name.trim(), email, phone || null, passwordHash, role
    );

    return res.status(201).json({
      message: 'Đã tạo tài khoản nhân sự.',
      user: { id: result.insertId, full_name: full_name.trim(), email, phone: phone || null, role },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getProfile, updateProfile, getExcludedIngredients, setExcludedIngredients, createStaff };
