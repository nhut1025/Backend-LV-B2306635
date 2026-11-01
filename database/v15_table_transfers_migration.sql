-- Table transfer history and configurable reservation-overlap window.

SET @reservation_id_type = (
  SELECT COLUMN_TYPE FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND column_name = 'id'
);
SET @bill_id_type = (
  SELECT COLUMN_TYPE FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bills' AND column_name = 'id'
);
SET @table_id_type = (
  SELECT COLUMN_TYPE FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'restaurant_tables' AND column_name = 'id'
);
SET @user_id_type = (
  SELECT COLUMN_TYPE FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'id'
);

SET @sql = CONCAT(
  'CREATE TABLE IF NOT EXISTS table_transfers (',
  'id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ',
  'reservation_id ', @reservation_id_type, ' NULL, ',
  'bill_id ', @bill_id_type, ' NULL, ',
  'from_table_id ', @table_id_type, ' NOT NULL, ',
  'to_table_id ', @table_id_type, ' NOT NULL, ',
  'moved_by ', @user_id_type, ' NULL, ',
  'moved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ',
  'FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL, ',
  'FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE SET NULL, ',
  'FOREIGN KEY (from_table_id) REFERENCES restaurant_tables(id), ',
  'FOREIGN KEY (to_table_id) REFERENCES restaurant_tables(id), ',
  'FOREIGN KEY (moved_by) REFERENCES users(id) ON DELETE SET NULL, ',
  'INDEX idx_table_transfers_reservation (reservation_id), ',
  'INDEX idx_table_transfers_moved_at (moved_at)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO settings (setting_key, setting_value)
VALUES ('table_transfer_duration_minutes', '120');
