const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const authModel = require('../models/auth.model');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/mailer');

const SALT_ROUNDS = 10;
const VERIFICATION_TOKEN_TTL_HOURS = 24;
const RESET_TOKEN_TTL_HOURS = 1;

function buildVerifyLink(token) {
  const frontendUrl = process.env.FRONTEND_VERIFY_EMAIL_URL || 'http://localhost:5173/verify-email';
  return `${frontendUrl}?token=${token}`;
}

function buildResetLink(token) {
  const frontendUrl = process.env.FRONTEND_RESET_PASSWORD_URL || 'http://localhost:5173/reset-password';
  return `${frontendUrl}?token=${token}`;
}

// POST /api/auth/register
async function register(req, res, next) {
  try {
    const { full_name, email, password, phone } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({ message: 'Thiếu full_name, email hoặc password.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password phải có ít nhất 6 ký tự.' });
    }

    const [existing] = await authModel.findByEmail(email);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email đã được sử dụng.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);

    const [result] = await authModel.createUser(full_name, email, phone || null, passwordHash, token, expiresAt);

    await sendVerificationEmail(email, buildVerifyLink(token));

    return res.status(201).json({
      message: 'Đăng ký thành công. Vui lòng kiểm tra email để xác thực tài khoản trước khi đăng nhập.',
      user: { id: result.insertId, full_name, email, role: 'customer', is_verified: false },
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Thiếu email hoặc password.' });
    }

    const [rows] = await authModel.findByEmail(email);

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
    }

    if (user.is_active === false || user.is_active === 0) {
      return res.status(403).json({
        message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản lý.',
        code: 'ACCOUNT_DISABLED',
      });
    }

    // Chặn login nếu chưa xác thực email — kiểm tra SAU khi verify đúng password,
    // để không lộ thông tin "email này tồn tại" cho người không biết mật khẩu.
    if (!user.is_verified) {
      return res.status(403).json({
        message: 'Tài khoản chưa xác thực email. Vui lòng kiểm tra email hoặc yêu cầu gửi lại link xác thực.',
        code: 'EMAIL_NOT_VERIFIED',
      });
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

// GET /api/auth/me
async function me(req, res, next) {
  try {
    const [rows] = await authModel.findById(req.user.id);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy user.' });
    }
    return res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/verify-email?token=xxx
// Trong thực tế, link trong email sẽ trỏ tới 1 trang frontend, trang đó gọi API này
// (hoặc gọi thẳng API này nếu chưa có frontend, test trực tiếp bằng Postman/trình duyệt).
async function verifyEmail(req, res, next) {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ message: 'Thiếu token.' });
    }

    const [rows] = await authModel.findByValidVerificationToken(token);
    if (rows.length === 0) {
      return res.status(400).json({ message: 'Token không hợp lệ, đã hết hạn, hoặc email đã được xác thực trước đó.' });
    }

    const user = rows[0];
    await authModel.markEmailVerified(user.id);

    return res.json({ message: 'Xác thực email thành công. Bạn có thể đăng nhập ngay bây giờ.' });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/resend-verification
// Body: { email }
// Trả về message chung chung dù email tồn tại/đã xác thực hay không, tránh dò quét email.
async function resendVerification(req, res, next) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Thiếu email.' });
    }

    const [rows] = await authModel.findByEmail(email);

    if (rows.length > 0 && !rows[0].is_verified) {
      const user = rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);

      await authModel.setVerificationToken(user.id, token, expiresAt);
      await sendVerificationEmail(user.email, buildVerifyLink(token));
    }

    return res.json({
      message: 'Nếu email tồn tại và chưa xác thực, link xác thực mới đã được gửi.',
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/forgot-password
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Thiếu email.' });

    const [rows] = await authModel.findByEmail(email);
    if (rows.length > 0) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000);
      await authModel.setResetToken(rows[0].id, tokenHash, expiresAt);
      await sendPasswordResetEmail(rows[0].email, buildResetLink(token));
    }

    return res.json({ message: 'Nếu email tồn tại, link đặt lại mật khẩu đã được gửi.' });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/reset-password, body: { token, password }
async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Thiếu token hoặc password.' });
    if (password.length < 6) return res.status(400).json({ message: 'Password phải có ít nhất 6 ký tự.' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const [result] = await authModel.updatePasswordAndClearResetToken(tokenHash, passwordHash);
    if (result.affectedRows === 0) {
      return res.status(400).json({ message: 'Token không hợp lệ hoặc đã hết hạn.' });
    }
    return res.json({ message: 'Đổi mật khẩu thành công. Bạn có thể đăng nhập lại.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, me, verifyEmail, resendVerification, forgotPassword, resetPassword };
