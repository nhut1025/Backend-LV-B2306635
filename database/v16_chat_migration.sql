-- Chat conversation lifecycle and private message attachment metadata.
-- Safe to run repeatedly against an existing database.

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'conversations' AND column_name = 'closed_at'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE conversations ADD COLUMN closed_at DATETIME NULL AFTER created_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'conversations' AND column_name = 'closed_by'
);
SET @user_id_type = (
  SELECT COLUMN_TYPE FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'id'
);
SET @sql = IF(@col_exists = 0,
  CONCAT('ALTER TABLE conversations ADD COLUMN closed_by ', @user_id_type, ' NULL AFTER closed_at'),
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations'
    AND COLUMN_NAME = 'closed_by' AND REFERENCED_TABLE_NAME = 'users'
);
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE conversations ADD CONSTRAINT fk_conversations_closed_by FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations'
    AND INDEX_NAME = 'idx_conversations_customer_status'
);
SET @sql = IF(@index_exists = 0,
  'ALTER TABLE conversations ADD INDEX idx_conversations_customer_status (customer_id, status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations'
    AND INDEX_NAME = 'idx_conversations_staff_status'
);
SET @sql = IF(@index_exists = 0,
  'ALTER TABLE conversations ADD INDEX idx_conversations_staff_status (staff_id, status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'messages' AND column_name = 'attachment_filename'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE messages ADD COLUMN attachment_filename VARCHAR(255) NULL AFTER is_read',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'messages' AND column_name = 'attachment_mime'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE messages ADD COLUMN attachment_mime VARCHAR(100) NULL AFTER attachment_filename',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'messages' AND column_name = 'attachment_size'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE messages ADD COLUMN attachment_size BIGINT UNSIGNED NULL AFTER attachment_mime',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'messages' AND column_name = 'attachment_path'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE messages ADD COLUMN attachment_path VARCHAR(500) NULL AFTER attachment_size',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages'
    AND INDEX_NAME = 'idx_messages_conversation_created'
);
SET @sql = IF(@index_exists = 0,
  'ALTER TABLE messages ADD INDEX idx_messages_conversation_created (conversation_id, created_at, id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
