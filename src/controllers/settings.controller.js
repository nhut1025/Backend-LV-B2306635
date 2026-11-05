const {
  getBankConfig,
  setBankConfig,
  getTableTransferDuration,
  getReservationTiming,
  setReservationTiming,
  validateReservationTiming,
  setSetting,
} = require('../utils/settings');
const { refreshReleaseExpiredHoldsSchedule } = require('../cron/releaseExpiredHolds.job');

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

async function getReservationRules(req, res, next) {
  try {
    const timing = await getReservationTiming();
    res.json({
      reservation_open_time: timing.reservation_open_time,
      reservation_close_time: timing.reservation_close_time,
      reservation_hold_minutes: timing.reservation_hold_minutes,
      cancellation_deadline_minutes: timing.cancellation_deadline_minutes,
      no_show_buffer_minutes: timing.no_show_buffer_minutes,
      reservation_restore_minutes: timing.reservation_restore_minutes,
      table_transfer_duration_minutes: timing.table_transfer_duration_minutes,
      reservation_hold_scan_seconds: timing.reservation_hold_scan_seconds,
    });
  } catch (err) {
    next(err);
  }
}

async function updateReservationTiming(req, res, next) {
  try {
    const input = {
      reservation_hold_minutes: req.body.reservation_hold_minutes,
      cancellation_deadline_minutes: req.body.cancellation_deadline_minutes,
      no_show_buffer_minutes: req.body.no_show_buffer_minutes,
      reservation_restore_minutes: req.body.reservation_restore_minutes,
      table_transfer_duration_minutes: req.body.table_transfer_duration_minutes,
      reservation_hold_scan_seconds: req.body.reservation_hold_scan_seconds,
      reservation_open_time: req.body.reservation_open_time,
      reservation_close_time: req.body.reservation_close_time,
    };
    const timing = validateReservationTiming(input);
    await setReservationTiming(timing);
    refreshReleaseExpiredHoldsSchedule();
    res.json({ message: 'Đã lưu cấu hình thời gian đặt bàn.', timing });
  } catch (err) {
    if (err.message.includes('phải là số nguyên') || err.message.includes('không hợp lệ')
      || err.message.includes('phải sớm hơn')) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
}

module.exports = {
  getBank,
  updateBank,
  getTableTransfer,
  updateTableTransfer,
  getReservationRules,
  updateReservationTiming,
};