const { pool } = require('../config/db');

// Thêm is_verified vào SELECT — login cần biết user đã xác thực email chưa.
async function findByEmail(email) {
  return pool.query(
    'SELECT id, full_name, email, password_hash, role, is_verified FROM users WHERE email = ?',
    [email]
  );
}

async function findById(id) {
  return pool.query(
    'SELECT id, full_name, email, phone, role, avatar_url, is_verified, created_at FROM users WHERE id = ?',
    [id]
  );
}

// Tạo user kèm token xác thực email ngay từ lúc đăng ký — is_verified mặc định FALSE.
async function createUser(fullName, email, phone, passwordHash, verificationToken, verificationTokenExpires) {
  return pool.query(
    `INSERT INTO users (full_name, email, phone, password_hash, role, is_verified, verification_token, verification_token_expires)
     VALUES (?, ?, ?, ?, 'customer', FALSE, ?, ?)`,
    [fullName, email, phone, passwordHash, verificationToken, verificationTokenExpires]
  );
}

// ---- Xác thực email ----

// Chỉ trả về user nếu token khớp, chưa hết hạn, và CHƯA xác thực trước đó.
async function findByValidVerificationToken(token) {
  return pool.query(
    `SELECT id, email FROM users
     WHERE verification_token = ? AND verification_token_expires > NOW() AND is_verified = FALSE`,
    [token]
  );
}

async function markEmailVerified(userId) {
  return pool.query(
    `UPDATE users
     SET is_verified = TRUE, verification_token = NULL, verification_token_expires = NULL
     WHERE id = ?`,
    [userId]
  );
}

// Dùng khi resend link xác thực (token cũ hết hạn hoặc bị mất email).
async function setVerificationToken(userId, token, expiresAt) {
  return pool.query(
    'UPDATE users SET verification_token = ?, verification_token_expires = ? WHERE id = ?',
    [token, expiresAt, userId]
  );
}

async function setResetToken(userId, tokenHash, expiresAt) {
  return pool.query(
    'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
    [tokenHash, expiresAt, userId]
  );
}

async function findByValidResetToken(tokenHash) {
  return pool.query(
    `SELECT id, email FROM users
     WHERE reset_token = ? AND reset_token_expires > NOW()`,
    [tokenHash]
  );
}

async function updatePasswordAndClearResetToken(tokenHash, passwordHash) {
  return pool.query(
    `UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL
     WHERE reset_token = ? AND reset_token_expires > NOW()`,
    [passwordHash, tokenHash]
  );
}

async function createInternalUser(fullName, email, phone, passwordHash, role) {
  return pool.query(
    `INSERT INTO users (full_name, email, phone, password_hash, role, is_verified)
     VALUES (?, ?, ?, ?, ?, TRUE)`,
    [fullName, email, phone, passwordHash, role]
  );
}

module.exports = {
  findByEmail,
  findById,
  createUser,
  findByValidVerificationToken,
  markEmailVerified,
  setVerificationToken,
  setResetToken,
  findByValidResetToken,
  updatePasswordAndClearResetToken,
  createInternalUser,
};
