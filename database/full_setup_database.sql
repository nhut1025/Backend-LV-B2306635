-- =====================================================================
-- FILE NÀY CHẠY ĐƯỢC NHIỀU LẦN MÀ KHÔNG LỖI, KHÔNG MẤT DỮ LIỆU.
-- Dùng cho cả 2 trường hợp: setup CSDL mới hoàn toàn, HOẶC bổ sung
-- cột/bảng còn thiếu vào CSDL đã có sẵn (như DB hiện tại của bạn).
-- Theo đúng: Tài liệu tổng hợp Website Quản lý & Đặt món Nhà hàng (v3)
-- =====================================================================

CREATE DATABASE IF NOT EXISTS quan_an_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE quan_an_db;

-- ============ 1. USERS ============
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(30) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('customer','staff','kitchen','manager') NOT NULL DEFAULT 'customer',
  avatar_url VARCHAR(500) NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_token VARCHAR(64) NULL,
  verification_token_expires DATETIME NULL,
  reset_token CHAR(64) NULL,
  reset_token_expires DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Nếu bảng users đã tồn tại từ trước với enum role cũ (chưa có 'kitchen'/'manager') -> vá lại
SET @role_ok = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'
    AND COLUMN_TYPE LIKE '%kitchen%' AND COLUMN_TYPE LIKE '%manager%'
);
SET @sql = IF(@role_ok = 0,
  "ALTER TABLE users MODIFY COLUMN role ENUM('customer','staff','kitchen','manager') NOT NULL DEFAULT 'customer'",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Nếu bảng users đã tồn tại từ trước mà chưa có reset_token/reset_token_expires -> vá lại
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'reset_token'
);
SET @sql = IF(@col_exists = 0,
  "ALTER TABLE users ADD COLUMN reset_token CHAR(64) NULL",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'reset_token_expires'
);
SET @sql = IF(@col_exists = 0,
  "ALTER TABLE users ADD COLUMN reset_token_expires DATETIME NULL",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============ 2. SETTINGS ============
CREATE TABLE IF NOT EXISTS settings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ 3. INGREDIENTS ============
CREATE TABLE IF NOT EXISTS ingredients (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ 4. DISHES ============
CREATE TABLE IF NOT EXISTS dishes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  description TEXT NULL,
  price DECIMAL(12,2) NOT NULL,
  category VARCHAR(100) NULL,
  image_url VARCHAR(500) NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ 5. DISH_INGREDIENTS ============
CREATE TABLE IF NOT EXISTS dish_ingredients (
  dish_id INT UNSIGNED NOT NULL,
  ingredient_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (dish_id, ingredient_id),
  FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE,
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ 6. USER_EXCLUDED_INGREDIENTS ============
CREATE TABLE IF NOT EXISTS user_excluded_ingredients (
  user_id INT UNSIGNED NOT NULL,
  ingredient_id INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, ingredient_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ 7. RESTAURANT_TABLES ============
CREATE TABLE IF NOT EXISTS restaurant_tables (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  table_number VARCHAR(10) NOT NULL UNIQUE,
  capacity INT NOT NULL,
  status ENUM('trong','giu_tam','da_dat','co_khach') NOT NULL DEFAULT 'trong',
  locked_by INT UNSIGNED NULL,
  locked_until DATETIME NULL,
  current_reservation_id INT UNSIGNED NULL,
  FOREIGN KEY (locked_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ 8. RESERVATIONS ============
CREATE TABLE IF NOT EXISTS reservations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  party_size INT NOT NULL,
  reservation_date DATE NOT NULL,
  reservation_time TIME NOT NULL,
  phone VARCHAR(15) NULL,
  status ENUM('giu_tam','da_dat','hoan_thanh','da_huy','qua_han') NOT NULL DEFAULT 'giu_tam',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at DATETIME NULL,
  cancelled_by ENUM('customer','staff') NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ 9. RESERVATION_TABLES (ghép bàn) ============
CREATE TABLE IF NOT EXISTS reservation_tables (
  reservation_id INT UNSIGNED NOT NULL,
  table_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (reservation_id, table_id),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
  FOREIGN KEY (table_id) REFERENCES restaurant_tables(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Thêm FK current_reservation_id -> reservations (chỉ thêm nếu chưa có)
SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'restaurant_tables'
    AND COLUMN_NAME = 'current_reservation_id' AND REFERENCED_TABLE_NAME = 'reservations'
);
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE restaurant_tables ADD CONSTRAINT fk_table_current_reservation FOREIGN KEY (current_reservation_id) REFERENCES reservations(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============ 10. DEPOSITS ============
CREATE TABLE IF NOT EXISTS deposits (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT UNSIGNED NOT NULL UNIQUE,
  amount DECIMAL(10,2) NOT NULL DEFAULT 50000,
  status ENUM('cho_thanh_toan','da_coc','dang_hoan','da_hoan','hoan_that_bai','mat_coc','da_tru_bill') NOT NULL DEFAULT 'cho_thanh_toan',
  transaction_code VARCHAR(100) NULL,
  refund_transaction_code VARCHAR(100) NULL,
  paid_at DATETIME NULL,
  refunded_at DATETIME NULL,
  refund_failed_reason VARCHAR(255) NULL,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ 11. BILLS ============
CREATE TABLE IF NOT EXISTS bills (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  table_id INT UNSIGNED NOT NULL,
  reservation_id INT UNSIGNED NULL,
  status ENUM('mo','da_thanh_toan') NOT NULL DEFAULT 'mo',
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  deposit_id INT UNSIGNED NULL,
  payment_method ENUM('online','tien_mat') NULL,
  payment_code VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  FOREIGN KEY (table_id) REFERENCES restaurant_tables(id),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (deposit_id) REFERENCES deposits(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ 12. BILL_ITEMS ============
CREATE TABLE IF NOT EXISTS bill_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bill_id INT UNSIGNED NOT NULL,
  dish_id INT UNSIGNED NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  status ENUM('cho_xac_nhan','dang_che_bien','san_sang','da_phuc_vu') NOT NULL DEFAULT 'cho_xac_nhan',
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  FOREIGN KEY (dish_id) REFERENCES dishes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Nếu bill_items đã tồn tại từ trước (chưa có cột status) -> bổ sung
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bill_items' AND column_name = 'status'
);
SET @sql = IF(@col_exists = 0,
  "ALTER TABLE bill_items ADD COLUMN status ENUM('cho_xac_nhan','dang_che_bien','san_sang','da_phuc_vu') NOT NULL DEFAULT 'cho_xac_nhan' AFTER unit_price",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============ 13. REVIEWS ============
CREATE TABLE IF NOT EXISTS reviews (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  bill_id INT UNSIGNED NOT NULL UNIQUE,
  rating TINYINT NOT NULL,
  comment TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ 14. CONVERSATIONS ============
CREATE TABLE IF NOT EXISTS conversations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  staff_id INT UNSIGNED NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id),
  FOREIGN KEY (staff_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ 15. MESSAGES ============
CREATE TABLE IF NOT EXISTS messages (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT UNSIGNED NOT NULL,
  sender_id INT UNSIGNED NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ 16. DISH_RECOMMENDATIONS ============
CREATE TABLE IF NOT EXISTS dish_recommendations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  dish_id INT UNSIGNED NOT NULL,
  model_name VARCHAR(50) NOT NULL DEFAULT 'popularity',
  score DECIMAL(10,4) NOT NULL DEFAULT 0,
  rank_order INT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Nếu dish_recommendations đã tồn tại từ trước (chưa có cột model_name) -> bổ sung
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dish_recommendations' AND column_name = 'model_name'
);
SET @sql = IF(@col_exists = 0,
  "ALTER TABLE dish_recommendations ADD COLUMN model_name VARCHAR(50) NOT NULL DEFAULT 'popularity' AFTER dish_id",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Đảm bảo ràng buộc UNIQUE (user_id, dish_id, model_name) -- tránh trùng gợi ý cùng 1 mô hình
SET @uq_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dish_recommendations'
    AND INDEX_NAME = 'uq_user_dish_model'
);
SET @sql = IF(@uq_exists = 0,
  'ALTER TABLE dish_recommendations ADD UNIQUE KEY uq_user_dish_model (user_id, dish_id, model_name)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Xóa ràng buộc UNIQUE cũ (user_id, dish_id) nếu còn tồn tại — ràng buộc này mâu thuẫn với
-- uq_user_dish_model (chặn việc lưu nhiều mô hình gợi ý khác nhau cho cùng 1 cặp khách-món)
SET @old_uq_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dish_recommendations'
    AND INDEX_NAME = 'uq_dish_recommendations_user_dish'
);
SET @sql = IF(@old_uq_exists > 0,
  'ALTER TABLE dish_recommendations DROP INDEX uq_dish_recommendations_user_dish',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============ 17. RECOMMENDATION_EVALUATIONS ============
CREATE TABLE IF NOT EXISTS recommendation_evaluations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  model_name VARCHAR(50) NOT NULL,
  k_value INT NOT NULL,
  precision_at_k DECIMAL(6,4) NOT NULL,
  recall_at_k DECIMAL(6,4) NOT NULL,
  ndcg_at_k DECIMAL(6,4) NOT NULL,
  evaluated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ INDEX HIỆU NĂNG (theo mục 3.7 tài liệu v3) ============
-- Mỗi index đều kiểm tra tồn tại trước khi tạo, an toàn chạy lại nhiều lần.

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND INDEX_NAME = 'idx_reservations_date');
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_reservations_date ON reservations(reservation_date)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND INDEX_NAME = 'idx_reservations_status');
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_reservations_status ON reservations(status)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bills' AND INDEX_NAME = 'idx_bills_status');
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_bills_status ON bills(status)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'restaurant_tables' AND INDEX_NAME = 'idx_tables_status');
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_tables_status ON restaurant_tables(status)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dish_ingredients' AND INDEX_NAME = 'idx_dish_ingredients_ingredient');
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_dish_ingredients_ingredient ON dish_ingredients(ingredient_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============ SEED: CẤU HÌNH MẶC ĐỊNH (settings) ============
-- INSERT IGNORE: nếu setting_key đã tồn tại thì bỏ qua, không ghi đè giá trị bạn đã tự chỉnh
INSERT IGNORE INTO settings (setting_key, setting_value) VALUES
  ('cancellation_deadline_minutes', '45'),
  ('no_show_buffer_minutes', '15'),
  ('reservation_hold_minutes', '3'),
  ('table_capacity_min', '1'),
  ('table_capacity_max', '16'),
  ('deposit_amount', '50000');

-- ============ SEED: TÀI KHOẢN MANAGER ĐẦU TIÊN (tuỳ chọn) ============
-- Bỏ qua đoạn này nếu bạn đã có sẵn tài khoản manager (ví dụ tài khoản System Manager
-- đã tạo trước đó). Đổi email/mật khẩu mẫu bên dưới trước khi chạy nếu muốn dùng.
-- Mật khẩu mẫu dưới đây tương ứng với hash demo, hãy đổi ngay sau khi đăng nhập lần đầu.

-- INSERT INTO users (full_name, email, password_hash, role, is_verified)
-- VALUES ('System Manager', 'manager@example.com', '<bcrypt_hash_cua_ban>', 'manager', TRUE)
-- ON DUPLICATE KEY UPDATE role = VALUES(role), is_verified = TRUE;

-- ============ KIỂM TRA LẠI SAU KHI CHẠY ============
SELECT * FROM settings;
SHOW TABLES;
