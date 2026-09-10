const { pool } = require('../config/db');

async function findByEmail(email) {
  return pool.query(
    'SELECT id, full_name, email, password_hash, role, is_active, is_verified FROM users WHERE email = ?',
    [email]
  );
}

async function findById(id) {
  return pool.query(
    'SELECT id, full_name, email, phone, role, avatar_url, is_active, is_verified, created_at FROM users WHERE id = ?',
    [id]
  );
}

async function createUser(fullName, email, phone, passwordHash, verificationToken, verificationTokenExpires) {
  return pool.query(
    `INSERT INTO users (full_name, email, phone, password_hash, role, is_verified, verification_token, verification_token_expires)
     VALUES (?, ?, ?, ?, 'customer', FALSE, ?, ?)`,
    [fullName, email, phone, passwordHash, verificationToken, verificationTokenExpires]
  );
}

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
    `INSERT INTO users (full_name, email, phone, password_hash, role, is_active, is_verified)
     VALUES (?, ?, ?, ?, ?, TRUE, TRUE)`,
    [fullName, email, phone, passwordHash, role]
  );
}

async function findStaffUsers() {
  return pool.query(
    `SELECT id, full_name, email, phone, role, is_active, is_verified, created_at
     FROM users
     WHERE role IN ('phuc_vu', 'thu_ngan', 'kitchen', 'manager')
     ORDER BY created_at DESC`
  );
}

async function findStaffById(id) {
  return pool.query(
    `SELECT id, full_name, email, phone, role, is_active, is_verified, created_at
     FROM users WHERE id = ? AND role IN ('phuc_vu', 'thu_ngan', 'kitchen', 'manager')`,
    [id]
  );
}

async function updateStaffById(id, fullName, phone, role) {
  return pool.query(
    'UPDATE users SET full_name = ?, phone = ?, role = ? WHERE id = ? AND role IN (\'phuc_vu\', \'thu_ngan\', \'kitchen\', \'manager\')',
    [fullName, phone, role, id]
  );
}

async function toggleStaffActive(id, isActive) {
  return pool.query(
    'UPDATE users SET is_active = ? WHERE id = ? AND role IN (\'phuc_vu\', \'thu_ngan\', \'kitchen\', \'manager\')',
    [isActive, id]
  );
}

// ---- Đăng nhập Google ----

async function findByGoogleId(googleId) {
  return pool.query(
    'SELECT id, full_name, email, role, is_active FROM users WHERE google_id = ?',
    [googleId]
  );
}

async function createGoogleUser(fullName, email, googleId) {
  return pool.query(
    `INSERT INTO users (full_name, email, google_id, role, is_active, is_verified)
     VALUES (?, ?, ?, 'customer', TRUE, TRUE)`,
    [fullName, email, googleId]
  );
}

// ---- Bảo vệ khỏi tự khóa / khóa hết manager ----

async function countActiveManagers() {
  return pool.query(
    `SELECT COUNT(*) AS count FROM users WHERE role = 'manager' AND is_active = TRUE`
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
  findStaffUsers,
  findStaffById,
  updateStaffById,
  toggleStaffActive,
  findByGoogleId,
  createGoogleUser,
  countActiveManagers,
};