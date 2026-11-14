const billModel = require('../models/bill.model');
const { emitToRoom } = require('../utils/socket');
const { getBankConfig } = require('../utils/settings');
const { buildVietQrUrl } = require('../utils/vietqr');

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

async function listMyHistory(req, res, next) {
  try {
    const bills = await billModel.findMyPaidBillHistory(req.user.id);
    res.json({ bills });
  } catch (err) {
    next(err);
  }
}

function validateBillReview(body) {
  const {
    rating,
    food_rating: foodRating,
    service_rating: serviceRating,
    ambience_rating: ambienceRating,
    comment,
    item_feedback: itemFeedback,
  } = (
    body && typeof body === 'object' ? body : {}
  );
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    const err = new Error('Đánh giá tổng thể phải từ 1 đến 5 sao.');
    err.status = 400;
    throw err;
  }
  for (const [label, value] of [
    ['món ăn', foodRating],
    ['phục vụ', serviceRating],
    ['không gian', ambienceRating],
  ]) {
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      const err = new Error(`Đánh giá ${label} phải từ 1 đến 5 sao.`);
      err.status = 400;
      throw err;
    }
  }
  if (typeof comment !== 'string' || !comment.trim() || comment.trim().length > 2000) {
    const err = new Error('Vui lòng nhập bình luận từ 1 đến 2000 ký tự.');
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(itemFeedback) || itemFeedback.some((item) => (
    !item || typeof item !== 'object'
    || !Number.isInteger(item.bill_item_id)
    || item.bill_item_id < 1
    || !['like', 'dislike'].includes(item.sentiment)
  ))) {
    const err = new Error('Phản hồi từng món không hợp lệ.');
    err.status = 400;
    throw err;
  }
  const itemIds = itemFeedback.map((item) => item.bill_item_id);
  if (new Set(itemIds).size !== itemIds.length) {
    const err = new Error('Mỗi món chỉ được đánh giá một lần trong bill.');
    err.status = 400;
    throw err;
  }
  return {
    rating,
    foodRating,
    serviceRating,
    ambienceRating,
    comment: comment.trim(),
    itemFeedback,
  };
}

async function listRestaurantReviews(req, res, next) {
  try {
    const rawRating = req.query.rating;
    const rawReplyStatus = req.query.reply_status;
    let replyStatus = 'all';
    if (rawReplyStatus !== undefined) {
      if (!['all', 'replied', 'unreplied'].includes(String(rawReplyStatus))) {
        return res.status(400).json({ message: 'Bộ lọc trạng thái phản hồi không hợp lệ.' });
      }
      replyStatus = String(rawReplyStatus);
    }
    let rating = null;
    if (rawRating !== undefined && rawRating !== 'all') {
      if (!['2', '3', '4', '5'].includes(String(rawRating))) {
        return res.status(400).json({ message: 'Bộ lọc số sao không hợp lệ.' });
      }
      rating = Number(rawRating);
    }
    const rawPage = req.query.page === undefined ? '1' : String(req.query.page);
    if (!/^[1-9]\d*$/.test(rawPage)) {
      return res.status(400).json({ message: 'Số trang không hợp lệ.' });
    }
    const page = Number(rawPage);
    if (!Number.isSafeInteger(page)) {
      return res.status(400).json({ message: 'Số trang không hợp lệ.' });
    }
    const perPage = 20;
    const offset = (page - 1) * perPage;
    if (!Number.isSafeInteger(offset) || offset > 10000000) {
      return res.status(400).json({ message: 'Số trang vượt quá giới hạn.' });
    }
    const result = await billModel.findRestaurantReviews({
      rating,
      replyStatus,
      limit: perPage,
      offset,
    });
    res.json({
      ...result,
      page,
      per_page: perPage,
      total_pages: Math.ceil(result.filtered_count / perPage),
    });
  } catch (err) {
    next(err);
  }
}

async function replyToBillReview(req, res, next) {
  try {
    const { reviewId } = req.params;
    if (!/^\d+$/.test(String(reviewId)) || !Number.isSafeInteger(Number(reviewId)) || Number(reviewId) < 1) {
      return res.status(400).json({ message: 'ID đánh giá không hợp lệ.' });
    }
    const reply = typeof req.body?.reply === 'string' ? req.body.reply.trim() : '';
    if (!reply || reply.length > 2000) {
      return res.status(400).json({ message: 'Phản hồi phải có từ 1 đến 2000 ký tự.' });
    }
    const savedReply = await billModel.saveManagerReviewReply(reviewId, req.user.id, reply);
    res.json({ message: 'Đã lưu phản hồi đánh giá.', reply: savedReply });
  } catch (err) {
    next(err);
  }
}

async function createBillReview(req, res, next) {
  try {
    const review = await billModel.savePaidBillReview(
      req.params.billId,
      req.user.id,
      validateBillReview(req.body),
      false
    );
    res.status(201).json({ message: 'Đã gửi đánh giá bill.', review });
  } catch (err) {
    next(err);
  }
}

async function updateBillReview(req, res, next) {
  try {
    const review = await billModel.savePaidBillReview(
      req.params.billId,
      req.user.id,
      validateBillReview(req.body),
      true
    );
    res.json({ message: 'Đã cập nhật đánh giá bill.', review });
  } catch (err) {
    next(err);
  }
}

// POST /api/bills/:billId/items — phuc_vu thêm món vào bill (đẩy realtime xuống bếp)
async function addItem(req, res, next) {
  try {
    const { billId } = req.params;
    const { dish_id, quantity, note } = req.body;

    if (!dish_id || !quantity || quantity <= 0) {
      return res.status(400).json({ message: 'Thiếu dish_id hoặc quantity không hợp lệ.' });
    }

    const itemId = await billModel.addItem(billId, dish_id, quantity, note);
    const data = await billModel.findBillWithItems(billId);

    const newItem = await billModel.findQueueItemById(itemId);
    emitToRoom('kitchen', 'kitchen:item-added', newItem);

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

    emitToRoom('kitchen', 'kitchen:item-removed', { id: Number(itemId) });

    res.json(data);
  } catch (err) {
    next(err);
  }
}

// ===== Phase 6: Kitchen Display System =====

// GET /api/bills/kitchen-queue — kitchen xem danh sách món cần nấu (mọi bàn)
async function kitchenQueue(req, res, next) {
  try {
    const rows = await billModel.findKitchenQueue();
    res.json({ queue: rows });
  } catch (err) {
    next(err);
  }
}

// GET /api/bills/ready-items — phuc_vu xem món đã nấu xong, chờ mang ra
async function readyItems(req, res, next) {
  try {
    const rows = await billModel.findReadyItems();
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/bills/items/:itemId/advance — kitchen chuyển món sang bước tiếp theo
async function advanceItem(req, res, next) {
  try {
    const { itemId } = req.params;
    const nextStatus = await billModel.advanceItemStatus(
      itemId,
      req.user.id,
      req.body?.expected_status
    );

    const item = await billModel.findQueueItemById(itemId);
    emitToRoom('kitchen', 'kitchen:item-updated', item);
    if (nextStatus === 'san_sang') {
      emitToRoom('phuc_vu', 'service:item-ready', item);
    }

    res.json({ message: `Đã chuyển sang ${nextStatus}.`, status: nextStatus, item });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/bills/items/:itemId/serve — phuc_vu đánh dấu đã mang món ra bàn
async function serveItem(req, res, next) {
  try {
    const { itemId } = req.params;
    await billModel.markItemServed(itemId);

    emitToRoom('phuc_vu', 'service:item-served', { id: Number(itemId) });

    res.json({ message: 'Đã đánh dấu đã phục vụ.' });
  } catch (err) {
    next(err);
  }
}

// ===== Phase 7: thanh toán bill cuối =====

// GET /api/bills/payable — thu_ngan xem danh sách bill đang mở (bàn nào cần thanh toán)
async function listPayable(req, res, next) {
  try {
    const bills = await billModel.listPayableBills();
    res.json({ bills });
  } catch (err) {
    next(err);
  }
}

// GET /api/bills/:billId/payment-summary — chi tiết bill + tổng tiền + trừ cọc
async function getPaymentSummary(req, res, next) {
  try {
    const data = await billModel.getPaymentSummary(req.params.billId);
    if (!data) {
      return res.status(404).json({ message: 'Không tìm thấy bill.' });
    }
    res.json(data);
  } catch (err) {
    next(err);
  }
}

// GET /api/bills/:billId/payment-qr — mã VietQR để khách quét chuyển khoản số tiền còn phải trả
async function getPaymentQr(req, res, next) {
  try {
    const { billId } = req.params;
    const data = await billModel.getPaymentSummary(billId);
    if (!data) {
      return res.status(404).json({ message: 'Không tìm thấy bill.' });
    }
    if (data.bill.status !== 'mo') {
      return res.status(409).json({ message: 'Bill này đã được thanh toán rồi.' });
    }
    if (data.summary.amount_due <= 0) {
      return res.status(409).json({ message: 'Không còn số tiền cần chuyển khoản (cọc đã đủ trả bill).' });
    }

    const bankConfig = await getBankConfig();
    if (!bankConfig.bank_bin || !bankConfig.account_number) {
      return res.status(503).json({ message: 'Quán chưa cấu hình tài khoản ngân hàng nhận tiền.' });
    }

    const paymentCode = `BILL${billId}`;
    const qrUrl = buildVietQrUrl({
      bankBin: bankConfig.bank_bin,
      accountNumber: bankConfig.account_number,
      amount: data.summary.amount_due,
      addInfo: paymentCode,
      accountName: bankConfig.account_name,
    });

    res.json({ amount: data.summary.amount_due, payment_code: paymentCode, qr_url: qrUrl });
  } catch (err) {
    next(err);
  }
}

// POST /api/bills/:billId/payment-request — phuc_vu/thu_ngan chọn phương thức, chờ thu ngân xác nhận
async function requestPayment(req, res, next) {
  try {
    const { billId } = req.params;
    const { payment_method } = req.body;

    if (!['tien_mat', 'online'].includes(payment_method)) {
      return res.status(400).json({ message: 'payment_method phải là "tien_mat" hoặc "online".' });
    }

    let bankConfig;
    if (payment_method === 'online') {
      bankConfig = await getBankConfig();
      if (!bankConfig.bank_bin || !bankConfig.account_number) {
        return res.status(503).json({ message: 'Quán chưa cấu hình tài khoản ngân hàng nhận tiền.' });
      }
    }

    const request = await billModel.requestPayment(billId, payment_method);
    const qrUrl = payment_method === 'online'
      ? buildVietQrUrl({
          bankBin: bankConfig.bank_bin,
          accountNumber: bankConfig.account_number,
          amount: request.summary.amount_due,
          addInfo: request.payment_code,
          accountName: bankConfig.account_name,
        })
      : null;

    emitToRoom('thu_ngan', 'cashier:payment-requested', {
      bill_id: request.bill_id,
      table_id: request.table_id,
      table_number: request.table_number,
      payment_method: request.payment_method,
      amount_due: request.summary.amount_due,
    });

    res.json({
      message: 'Đã gửi yêu cầu thanh toán, chờ thu ngân xác nhận.',
      ...request,
      qr_url: qrUrl,
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/bills/:billId/pay — thu_ngan xác nhận đã thu tiền. Body: { payment_method: 'tien_mat' | 'online' }
async function payBill(req, res, next) {
  try {
    const { billId } = req.params;
    const { payment_method } = req.body;

    if (!['tien_mat', 'online'].includes(payment_method)) {
      return res.status(400).json({ message: 'payment_method phải là "tien_mat" hoặc "online".' });
    }

    const result = await billModel.payBill(billId, payment_method, req.user.id);
    emitToRoom('phuc_vu', 'service:bill-paid', result);
    res.json({ message: 'Đã xác nhận thanh toán. Bàn đã về trạng thái trống.', ...result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getByTable,
  listMyHistory,
  listRestaurantReviews,
  replyToBillReview,
  createBillReview,
  updateBillReview,
  addItem,
  removeItem,
  kitchenQueue,
  readyItems,
  advanceItem,
  serveItem,
  listPayable,
  getPaymentSummary,
  getPaymentQr,
  requestPayment,
  payBill,
};