const { getBankConfig, setBankConfig } = require('../utils/settings');

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

module.exports = { getBank, updateBank };