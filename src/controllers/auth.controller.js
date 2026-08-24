
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const SALT_ROUNDS = 10;

async function register(req, res, next) {
  try {
    const { full_name, email, password, phone } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({ message: 'Thiếu full_name, email hoặc password.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password phải có ít nhất 6 ký tự.' });
    }

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email đã được sử dụng.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const [result] = await pool.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role)
       VALUES (?, ?, ?, ?, 'customer')`,
      [full_name, email, phone || null, passwordHash]
    );

    return res.status(201).json({
      message: 'Đăng ký thành công.',
      user: { id: result.insertId, full_name, email, role: 'customer' },
    });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Thiếu email hoặc password.' });
    }

    const [rows] = await pool.query(
      'SELECT id, full_name, email, password_hash, role FROM users WHERE email = ?',
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.json({
      message: 'Đăng nhập thành công.',
      token,
      user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT id, full_name, email, phone, role, avatar_url, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy user.' });
    }
    return res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, me };
