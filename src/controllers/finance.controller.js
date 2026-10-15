const financeModel = require('../models/finance.model');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Đọc 1 tham số id dạng số dương từ query; trả về { value, invalid }
function parseId(raw) {
  if (raw === undefined || raw === '') return { value: null, invalid: false };
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? { value, invalid: false } : { value: null, invalid: true };
}

// GET /api/finance/bills?from=YYYY-MM-DD&to=YYYY-MM-DD&table_id=&cashier_id=&payment_method=
async function listBills(req, res, next) {
  try {
    const { from, to, payment_method } = req.query;

    if ((from && !DATE_PATTERN.test(from)) || (to && !DATE_PATTERN.test(to))) {
      return res.status(400).json({ message: 'from/to phải có dạng YYYY-MM-DD.' });
    }
    if (from && to && from > to) {
      return res.status(400).json({ message: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.' });
    }
    if (payment_method && !['tien_mat', 'online'].includes(payment_method)) {
      return res.status(400).json({ message: 'payment_method phải là "tien_mat" hoặc "online".' });
    }

    const table = parseId(req.query.table_id);
    const cashier = parseId(req.query.cashier_id);
    if (table.invalid || cashier.invalid) {
      return res.status(400).json({ message: 'table_id/cashier_id phải là số nguyên dương.' });
    }

    const bills = await financeModel.listPaidBills({
      from,
      to,
      tableId: table.value,
      cashierId: cashier.value,
      paymentMethod: payment_method,
    });

    res.json({ bills, totals: financeModel.summarize(bills) });
  } catch (err) {
    next(err);
  }
}

// GET /api/finance/bills/:billId — chi tiết 1 bill đã thanh toán (món, người xác nhận)
async function getBillDetail(req, res, next) {
  try {
    const data = await financeModel.findPaidBillDetail(req.params.billId);
    if (!data) {
      return res.status(404).json({ message: 'Không tìm thấy bill đã thanh toán.' });
    }
    res.json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = { listBills, getBillDetail };