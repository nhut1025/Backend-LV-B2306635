const { pool } = require('../config/db');

const DEFAULT_BANK_CONFIG = {
  bank_bin: process.env.DEFAULT_BANK_BIN || '',
  account_number: process.env.DEFAULT_BANK_ACCOUNT_NUMBER || '',
  account_name: process.env.DEFAULT_BANK_ACCOUNT_NAME || '',
};

async function getSetting(key, defaultValue = null) {
  const [rows] = await pool.query(
    'SELECT setting_value FROM settings WHERE setting_key = ?',
    [key]
  );
  if (rows.length === 0) return defaultValue;
  return rows[0].setting_value;
}

async function setSetting(key, value) {
  return pool.query(
    `INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value]
  );
}

async function getCapacityRange() {
  const min = parseInt(await getSetting('table_capacity_min', '1'), 10);
  const max = parseInt(await getSetting('table_capacity_max', '16'), 10);
  return { min, max };
}

async function getBankConfig() {
  const bankBin = await getSetting('restaurant_bank_bin', '');
  const accountNumber = await getSetting('restaurant_account_number', '');
  const accountName = await getSetting('restaurant_account_name', '');

  return {
    bank_bin: bankBin || DEFAULT_BANK_CONFIG.bank_bin,
    account_number: accountNumber || DEFAULT_BANK_CONFIG.account_number,
    account_name: accountName || DEFAULT_BANK_CONFIG.account_name,
  };
}

async function setBankConfig({ bank_bin, account_number, account_name }) {
  await setSetting('restaurant_bank_bin', bank_bin);
  await setSetting('restaurant_account_number', account_number);
  await setSetting('restaurant_account_name', account_name);
}

module.exports = { getSetting, setSetting, getCapacityRange, getBankConfig, setBankConfig };