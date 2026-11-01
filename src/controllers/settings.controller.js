const {
  getBankConfig,
  setBankConfig,
  getTableTransferDuration,
  setSetting,
} = require('../utils/settings');

// GET /api/settings/bank — xem cấu hình tài khoản ngân hàng nhận cọc hiện tại
async function getBank(req, res, next) {
  try {
    const config = await getBankConfig();
    res.json({ bank: config });
  } catch (err) {
    next(err);
  }
}

// PUT /api/settings/bank — manager cấu hình lại tài khoản ngân hàng nhận cọc
async function updateBank(req, res, next) {
  try {
    const { bank_bin, account_number, account_name } = req.body;
    if (!bank_bin || !account_number || !account_name) {
      return res.status(400).json({ message: 'Thiếu bank_bin, account_number hoặc account_name.' });
    }
    await setBankConfig({ bank_bin, account_number, account_name });
    res.json({ message: 'Đã cập nhật tài khoản ngân hàng nhận cọc.' });
  } catch (err) {
    next(err);
  }
}

async function getTableTransfer(req, res, next) {
  try {
    const durationMinutes = await getTableTransferDuration();
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) {
      throw new Error('Cấu hình table_transfer_duration_minutes phải nằm trong khoảng 15–1440.');
    }
    res.json({ duration_minutes: durationMinutes });
  } catch (err) {
    next(err);
  }
}

async function updateTableTransfer(req, res, next) {
  try {
    const durationMinutes = Number(req.body.duration_minutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) {
      return res.status(400).json({ message: 'duration_minutes phải là số nguyên từ 15 đến 1440.' });
    }
    await setSetting('table_transfer_duration_minutes', String(durationMinutes));
    res.json({ message: 'Đã cập nhật thời lượng sử dụng bàn.', duration_minutes: durationMinutes });
  } catch (err) {
    next(err);
  }
}

module.exports = { getBank, updateBank, getTableTransfer, updateTableTransfer };