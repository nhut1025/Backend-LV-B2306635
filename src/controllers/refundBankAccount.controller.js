const refundBankAccountModel = require('../models/refundBankAccount.model');

function parseAccountId(value) {
  const accountId = Number(value);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    const error = new Error('ID tài khoản nhận hoàn cọc không hợp lệ.');
    error.status = 400;
    throw error;
  }
  return accountId;
}

function parseAccountDetails(body, requireDefault) {
  const input = body && typeof body === 'object' ? body : {};
  const bankCode = typeof input.bank_code === 'string' ? input.bank_code.trim() : '';
  const accountNumber = typeof input.account_number === 'string' ? input.account_number.trim() : '';
  const accountName = typeof input.account_name === 'string' ? input.account_name.trim() : '';
  if (!bankCode || bankCode.length > 20 || !accountNumber || accountNumber.length > 50
    || !accountName || accountName.length > 100) {
    const error = new Error('Vui lòng nhập ngân hàng, số tài khoản và tên chủ tài khoản hợp lệ.');
    error.status = 400;
    throw error;
  }
  if (requireDefault && typeof input.is_default !== 'boolean') {
    const error = new Error('is_default phải là true hoặc false.');
    error.status = 400;
    throw error;
  }
  if (input.is_default !== undefined && typeof input.is_default !== 'boolean') {
    const error = new Error('is_default phải là true hoặc false.');
    error.status = 400;
    throw error;
  }

  return {
    bankCode,
    accountNumber,
    accountName,
    isDefault: input.is_default === true,
  };
}

async function listMine(req, res, next) {
  try {
    const accounts = await refundBankAccountModel.findByUserId(req.user.id);
    res.json({ accounts });
  } catch (error) {
    next(error);
  }
}

async function createMine(req, res, next) {
  try {
    const details = parseAccountDetails(req.body, false);
    const accountId = await refundBankAccountModel.create(req.user.id, details);
    const accounts = await refundBankAccountModel.findByUserId(req.user.id);
    res.status(201).json({
      message: 'Đã thêm tài khoản nhận hoàn cọc.',
      account: accounts.find((account) => Number(account.id) === Number(accountId)),
    });
  } catch (error) {
    next(error);
  }
}

async function updateMine(req, res, next) {
  try {
    const accountId = parseAccountId(req.params.id);
    const details = parseAccountDetails(req.body, true);
    await refundBankAccountModel.update(req.user.id, accountId, details);
    const accounts = await refundBankAccountModel.findByUserId(req.user.id);
    res.json({
      message: 'Đã cập nhật tài khoản nhận hoàn cọc.',
      account: accounts.find((account) => Number(account.id) === accountId),
    });
  } catch (error) {
    next(error);
  }
}

async function deleteMine(req, res, next) {
  try {
    const accountId = parseAccountId(req.params.id);
    await refundBankAccountModel.remove(req.user.id, accountId);
    res.json({ message: 'Đã xóa tài khoản nhận hoàn cọc.' });
  } catch (error) {
    next(error);
  }
}

module.exports = { listMine, createMine, updateMine, deleteMine };
