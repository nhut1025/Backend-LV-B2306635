const reservationModel = require('../models/reservation.model');
const { getBankConfig } = require('../utils/settings');
const { buildVietQrUrl } = require('../utils/vietqr');

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
    await reservationModel.confirmDeposit(id);
    res.json({ message: 'Đã xác nhận nhận cọc. Bàn chuyển sang trạng thái đã đặt.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { suggestTables, createHold, listMine, getMineById, getDepositQr, listPendingDeposits, confirmDeposit, listUpcoming, confirmArrival };