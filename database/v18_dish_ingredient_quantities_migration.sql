-- Add optional gram quantities for each dish ingredient.
-- Existing ingredient links remain and their quantities default to NULL.

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'dish_ingredients'
    AND column_name = 'quantity_g'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE dish_ingredients ADD COLUMN quantity_g DECIMAL(10,2) NULL AFTER ingredient_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
