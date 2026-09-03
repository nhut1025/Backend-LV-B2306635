-- =========================================================
-- MIGRATION 1 LẦN CHỈ CHO DB HIỆN TẠI CỦA BẠN
-- Chạy 1 lần duy nhất để cập nhật schema sang v7.
-- =========================================================

-- 1) Cập nhật enum role cho users theo v7
ALTER TABLE users
  MODIFY COLUMN role ENUM('customer','phuc_vu','thu_ngan','kitchen','manager')
  NOT NULL DEFAULT 'customer';

-- 2) Thêm cột is_active nếu chưa có
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER role;

-- 3) Nếu dữ liệu cũ còn role 'staff', chuyển về role mới phù hợp
UPDATE users
SET role = 'phuc_vu'
WHERE role = 'staff';

-- 4) Đảm bảo mọi record đều có giá trị is_active hợp lệ
UPDATE users
SET is_active = TRUE
WHERE is_active IS NULL;

-- 5) Nếu bạn muốn kiểm tra nhanh sau khi chạy
SELECT id, full_name, email, role, is_active
FROM users
ORDER BY id;
