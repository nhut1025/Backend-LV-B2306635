const { pool } = require('../config/db');

const RESERVATION_TIMING_DEFAULTS = {
  reservation_hold_minutes: 15,
  cancellation_deadline_minutes: 45,
  no_show_buffer_minutes: 15,
  reservation_restore_minutes: 30,
  table_transfer_duration_minutes: 120,
  reservation_hold_scan_seconds: 30,
  reservation_open_time: '07:00',
  reservation_close_time: '21:00',
};

const RESERVATION_TIMING_RANGES = {
  reservation_hold_minutes: [1, 60, 'phút'],
  cancellation_deadline_minutes: [0, 1440, 'phút'],
  no_show_buffer_minutes: [0, 240, 'phút'],
  reservation_restore_minutes: [1, 1440, 'phút'],
  table_transfer_duration_minutes: [15, 1440, 'phút'],
  reservation_hold_scan_seconds: [5, 300, 'giây'],
};

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

async function getTableTransferDuration() {
  return parseInt(await getSetting('table_transfer_duration_minutes', '120'), 10);
}

function validateReservationTiming(timing) {
  for (const [key, [minimum, maximum, unit]] of Object.entries(RESERVATION_TIMING_RANGES)) {
    const value = Number(timing[key]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`Cấu hình ${key} phải là số nguyên từ ${minimum} đến ${maximum} ${unit}.`);
    }
    timing[key] = value;
  }

  for (const key of ['reservation_open_time', 'reservation_close_time']) {
    if (typeof timing[key] !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timing[key])) {
      throw new Error(`Cấu hình ${key} không hợp lệ.`);
    }
  }
  if (timing.reservation_open_time >= timing.reservation_close_time) {
    throw new Error('Giờ mở cửa phải sớm hơn giờ đóng cửa.');
  }
  return timing;
}

async function getReservationTiming() {
  const keys = Object.keys(RESERVATION_TIMING_DEFAULTS);
  const [rows] = await pool.query(
    'SELECT setting_key, setting_value FROM settings WHERE setting_key IN (?)',
    [keys]
  );
  const values = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
  const timing = Object.fromEntries(keys.map((key) => [
    key,
    values.get(key) ?? String(RESERVATION_TIMING_DEFAULTS[key]),
  ]));
  return validateReservationTiming(timing);
}

async function setReservationTiming(timing) {
  const values = Object.entries(timing).map(([key, value]) => [key, String(value)]);
  await pool.query(
    `INSERT INTO settings (setting_key, setting_value) VALUES ?
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [values]
  );
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

module.exports = {
  getSetting,
  setSetting,
  getReservationTiming,
  setReservationTiming,
  validateReservationTiming,
  getCapacityRange,
  getTableTransferDuration,
  getBankConfig,
  setBankConfig,
};