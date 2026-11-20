-- Store customer-owned bank accounts used to receive deposit refunds.
SET @user_id_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'id'
);

SET @create_refund_bank_accounts_sql = CONCAT(
  'CREATE TABLE IF NOT EXISTS user_refund_bank_accounts (',
  'id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ',
  'user_id ', @user_id_type, ' NOT NULL, ',
  'bank_code VARCHAR(20) NOT NULL, ',
  'account_number VARCHAR(50) NOT NULL, ',
  'account_name VARCHAR(100) NOT NULL, ',
  'is_default BOOLEAN NOT NULL DEFAULT FALSE, ',
  'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ',
  'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, ',
  'INDEX idx_refund_bank_accounts_user_default (user_id, is_default), ',
  'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
);

PREPARE create_refund_bank_accounts_stmt FROM @create_refund_bank_accounts_sql;
EXECUTE create_refund_bank_accounts_stmt;
DEALLOCATE PREPARE create_refund_bank_accounts_stmt;
