
const { pool } = require('../config/db');

async function getSetting(key, defaultValue = null) {
  const [rows] = await pool.query(
    'SELECT setting_value FROM settings WHERE setting_key = ?',
    [key]
  );
  if (rows.length === 0) return defaultValue;
  return rows[0].setting_value;
}

async function getCapacityRange() {
  const min = parseInt(await getSetting('table_capacity_min', '1'), 10);
  const max = parseInt(await getSetting('table_capacity_max', '16'), 10);
  return { min, max };
}

module.exports = { getSetting, getCapacityRange };
