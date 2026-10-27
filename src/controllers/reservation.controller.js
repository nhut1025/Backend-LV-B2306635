const reservationModel = require('../models/reservation.model');
const { emitToRoom } = require('../utils/socket');
const { getBankConfig } = require('../utils/settings');
const { buildVietQrUrl } = require('../utils/vietqr');

function parsePreorderItems(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    const err = new Error('preorder_items phải là một danh sách.');
    err.status = 400;
    throw err;
  }

  const seenDishIds = new Set();
  return value.map((item) => {
    if (!item || !Number.isSafeInteger(Number(item.dish_id)) || Number(item.dish_id) <= 0) {
      const err = new Error('Mỗi món đặt trước phải có dish_id hợp lệ.');
      err.status = 400;
      throw err;
    }
    if (!Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1 || Number(item.quantity) > 99) {
      const err = new Error('Số lượng mỗi món đặt trước phải từ 1 đến 99.');
      err.status = 400;
      throw err;
    }
    const dishId = Number(item.dish_id);
    if (seenDishIds.has(dishId)) {
      const err = new Error('Không gửi trùng món trong preorder_items.');
      err.status = 400;
      throw err;
    }
    if (item.note !== undefined && item.note !== null && (typeof item.note !== 'string' || item.note.length > 255)) {
      const err = new Error('Ghi chú món đặt trước không được vượt quá 255 ký tự.');
      err.status = 400;
      throw err;
    }
    seenDishIds.add(dishId);
    return {
      dishId,
      quantity: Number(item.quantity),
      note: item.note || null,
    };
  });
}

async function suggestTables(req, res, next) {
  try {
    const partySize = Number(req.query.party_size);
    if (!partySize || partySize <= 0) {
      return res.status(400).json({ message: 'Thiếu hoặc sai party_size.' });
    }

    const freeTables = await reservationModel.findFreeTables();
    const combo = reservationModel.suggestTableCombo(freeTables, partySize);

    if (!combo) {
      return res.status(409).json({ message: 'Hiện không đủ bàn trống cho số lượng khách này.' });
    }

    res.json({
      tables: combo,
      is_combined: combo.length > 1,
      total_capacity: combo.reduce((sum, t) => sum + t.capacity, 0),
    });
  } catch (err) {
    next(err);
  }
}

async function createHold(req, res, next) {
  try {
    const userId = req.user.id;
    const { party_size, reservation_date, reservation_time, phone, table_ids } = req.body;
    const preorderItems = parsePreorderItems(req.body.preorder_items);

    if (!party_size || !reservation_date || !reservation_time || !phone) {
      return res.status(400).json({ message: 'Thiếu party_size, reservation_date, reservation_time hoặc phone.' });
    }
    if (!Array.isArray(table_ids) || table_ids.length === 0) {
      return res.status(400).json({ message: 'Thiếu table_ids (danh sách bàn đã chọn).' });
    }

    const result = await reservationModel.createHold(userId, {
      partySize: Number(party_size),
      reservationDate: reservation_date,
      reservationTime: reservation_time,
      phone,
      tableIds: table_ids,
      preorderItems,
    });

    res.status(201).json({
      reservation_id: result.reservationId,
      status: 'giu_tam',
      hold_minutes: result.holdMinutes,
      table_ids: result.tableIds,
    });
  } catch (err) {
    next(err);
  }
}

async function getMyPreorder(req, res, next) {
  try {
    const preorder = await reservationModel.findMyPreorder(req.user.id, req.params.id);
    if (!preorder) {
      return res.status(404).json({ message: 'Không tìm thấy món đặt trước cho đơn đặt bàn này.' });
    }
    res.json({ preorder });
  } catch (err) {
    next(err);
  }
}

async function listPendingPreorders(req, res, next) {
  try {
    const preorders = await reservationModel.findPendingPreorders();
    res.json({ preorders });
  } catch (err) {
    next(err);
  }
}

async function recordPreorderContact(req, res, next) {
  try {
    const { result } = req.body;
    const allowedResults = ['da_xac_nhan', 'khong_nghe_may', 'tu_choi'];
    if (!allowedResults.includes(result)) {
      return res.status(400).json({
        message: 'result phải là da_xac_nhan, khong_nghe_may hoặc tu_choi.',
      });
    }
    await reservationModel.recordPreorderContact(req.params.id, req.user.id, result);
    res.json({ message: 'Đã cập nhật kết quả liên hệ khách.', contact_status: result });
  } catch (err) {
    next(err);
  }
}

async function preparePreorder(req, res, next) {
  try {
    const result = await reservationModel.preparePreorder(req.params.id, req.user.id);
    if (!result.alreadyPrepared) {
      for (const item of result.items) emitToRoom('kitchen', 'kitchen:item-added', item);
    }
    res.json({
      message: result.alreadyPrepared
        ? 'Món đặt trước đã được đưa vào bill trước đó.'
        : 'Đã đưa món đặt trước vào bill và gửi đến bếp.',
      bill_id: result.billId,
      already_prepared: result.alreadyPrepared,
    });
  } catch (err) {
    next(err);
  }
}

async function listMine(req, res, next) {
  try {
    const rows = await reservationModel.findMyReservations(req.user.id);
    res.json({ reservations: rows });
  } catch (err) {
    next(err);
  }
}

async function getMineById(req, res, next) {
  try {
    const { id } = req.params;
    const rows = await reservationModel.findMyReservationById(req.user.id, id);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đặt bàn.' });
    }
    res.json({ reservation: rows[0] });
  } catch (err) {
    next(err);
  }
}

// GET /api/reservations/upcoming — phuc_vu xem danh sách đặt bàn sắp tới để chuẩn bị
async function listUpcoming(req, res, next) {
  try {
    const rows = await reservationModel.findUpcomingReservations();
    res.json({ upcoming: rows });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/reservations/:id/confirm-arrival — phuc_vu xác nhận khách đã đến
async function confirmArrival(req, res, next) {
  try {
    const { id } = req.params;
    await reservationModel.confirmArrival(id);
    res.json({ message: 'Đã xác nhận khách đến. Bàn chuyển sang trạng thái có khách.' });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/reservations/:id/cancel-by-staff — phuc_vu hủy đặt bàn thủ công
async function cancelReservationByStaff(req, res, next) {
  try {
    const { id } = req.params;
    const result = await reservationModel.cancelReservation(id, {
      actor: 'staff',
      refundBankCode: req.body.refund_bank_code,
      refundAccountNumber: req.body.refund_account_number,
      refundAccountName: req.body.refund_account_name,
      acceptForfeiture: req.body.accept_forfeiture === true,
    });
    if (result.refundEligible) {
      emitToRoom('manager', 'refund:requested', {
        reservation_id: result.reservationId,
        amount: result.depositAmount,
      });
    }
    res.json({
      message: result.refundEligible
        ? 'Đã hủy đặt bàn. Yêu cầu hoàn cọc đã được gửi đến quản lý.'
        : result.depositStatus === 'mat_coc'
          ? 'Đã hủy đặt bàn. Cọc bị mất theo quy định và bàn đã được giải phóng.'
          : 'Đã hủy lượt giữ bàn chưa thanh toán và giải phóng bàn.',
      deposit_status: result.depositStatus,
    });
  } catch (err) {
    next(err);
  }
}

async function cancelMyReservation(req, res, next) {
  try {
    const result = await reservationModel.cancelReservation(req.params.id, {
      actor: 'customer',
      userId: req.user.id,
      refundBankCode: req.body.refund_bank_code,
      refundAccountNumber: req.body.refund_account_number,
      refundAccountName: req.body.refund_account_name,
      acceptForfeiture: req.body.accept_forfeiture === true,
    });
    if (result.refundEligible) {
      emitToRoom('manager', 'refund:requested', {
        reservation_id: result.reservationId,
        amount: result.depositAmount,
      });
    }
    res.json({
      message: result.refundEligible
        ? 'Đã hủy đặt bàn. Yêu cầu hoàn cọc đã được gửi đến quản lý.'
        : result.depositStatus === 'mat_coc'
          ? 'Đã hủy đặt bàn. Cọc bị mất theo quy định.'
          : 'Đã hủy lượt giữ bàn chưa thanh toán.',
      deposit_status: result.depositStatus,
    });
  } catch (err) {
    next(err);
  }
}

async function listPendingRefunds(req, res, next) {
  try {
    const pending = await reservationModel.findPendingRefunds();
    res.json({ pending });
  } catch (err) {
    next(err);
  }
}

async function confirmRefund(req, res, next) {
  try {
    await reservationModel.confirmRefund(req.params.id, req.user.id);
    res.json({ message: 'Đã ghi nhận hoàn cọc thành công.' });
  } catch (err) {
    next(err);
  }
}

// ===== Phase 3: thanh toán cọc qua VietQR =====

// GET /api/reservations/:id/deposit-qr — khách xem mã QR để chuyển khoản cọc
async function getDepositQr(req, res, next) {
  try {
    const { id } = req.params;
    const rows = await reservationModel.findDepositByReservationId(id, req.user.id);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy cọc cho đơn đặt bàn này.' });
    }

    const deposit = rows[0];
    const bankConfig = await getBankConfig();

    if (!bankConfig.bank_bin || !bankConfig.account_number) {
      return res.status(503).json({
        message: 'Quán chưa cấu hình tài khoản ngân hàng nhận cọc. Vui lòng liên hệ nhân viên.',
      });
    }

    const qrUrl = buildVietQrUrl({
      bankBin: bankConfig.bank_bin,
      accountNumber: bankConfig.account_number,
      amount: deposit.amount,
      addInfo: deposit.transaction_code,
      accountName: bankConfig.account_name,
    });

    res.json({
      deposit_status: deposit.status,
      amount: deposit.amount,
      transaction_code: deposit.transaction_code,
      qr_url: qrUrl,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/reservations/pending-deposits — thu_ngan xem danh sách cọc chờ xác nhận
async function listPendingDeposits(req, res, next) {
  try {
    const rows = await reservationModel.findPendingDeposits();
    res.json({ pending: rows });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/reservations/:id/confirm-deposit — thu_ngan xác nhận đã nhận cọc
async function confirmDeposit(req, res, next) {
  try {
    const { id } = req.params;
        await reservationModel.confirmDeposit(id, req.user.id);
    res.json({ message: 'Đã xác nhận nhận cọc. Bàn chuyển sang trạng thái đã đặt.' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  suggestTables,
  createHold,
  getMyPreorder,
  listPendingPreorders,
  recordPreorderContact,
  preparePreorder,
  listMine,
  getMineById,
  getDepositQr,
  listPendingDeposits,
  confirmDeposit,
  listUpcoming,
  confirmArrival,
  cancelReservationByStaff,
  cancelMyReservation,
  listPendingRefunds,
  confirmRefund,
};