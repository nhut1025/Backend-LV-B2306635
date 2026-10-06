const billModel = require('../models/bill.model');

// GET /api/bills/table/:tableId — phuc_vu mở bill của 1 bàn (tự tạo nếu chưa có)
async function getByTable(req, res, next) {
  try {
    const { tableId } = req.params;
    const billId = await billModel.getOrCreateOpenBill(tableId);
    const data = await billModel.findBillWithItems(billId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

// POST /api/bills/:billId/items — phuc_vu thêm món vào bill
async function addItem(req, res, next) {
  try {
    const { billId } = req.params;
    const { dish_id, quantity, note } = req.body;

    if (!dish_id || !quantity || quantity <= 0) {
      return res.status(400).json({ message: 'Thiếu dish_id hoặc quantity không hợp lệ.' });
    }

    await billModel.addItem(billId, dish_id, quantity, note);
    const data = await billModel.findBillWithItems(billId);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

// DELETE /api/bills/:billId/items/:itemId — phuc_vu xoá món (chỉ khi còn chờ xác nhận)
async function removeItem(req, res, next) {
  try {
    const { billId, itemId } = req.params;
    const affectedRows = await billModel.removeItem(billId, itemId);
    if (affectedRows === 0) {
      return res.status(409).json({ message: 'Không thể xoá — món không tồn tại hoặc bếp đã bắt đầu chế biến.' });
    }
    const data = await billModel.findBillWithItems(billId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = { getByTable, addItem, removeItem };