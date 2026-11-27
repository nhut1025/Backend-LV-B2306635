-- Keep historical bill and reservation references when a table is retired.
SET @is_active_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'restaurant_tables'
    AND COLUMN_NAME = 'is_active'
);

SET @add_table_is_active_sql = IF(
  @is_active_exists = 0,
  'ALTER TABLE restaurant_tables ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1'
);

PREPARE add_table_is_active_stmt FROM @add_table_is_active_sql;
EXECUTE add_table_is_active_stmt;
DEALLOCATE PREPARE add_table_is_active_stmt;
