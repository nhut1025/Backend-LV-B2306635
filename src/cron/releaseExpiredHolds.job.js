const cron = require('node-cron');
const reservationModel = require('../models/reservation.model');

async function releaseExpiredHolds() {
  try {
    const expiredIds = await reservationModel.findExpiredHeldReservationIds();
    for (const reservationId of expiredIds) {
      await reservationModel.releaseExpiredReservation(reservationId);
      console.log(`[cron] Đã giải phóng bàn giữ tạm hết hạn cho reservation #${reservationId}`);
    }
  } catch (err) {
    console.error('[cron] Lỗi khi giải phóng bàn giữ tạm hết hạn:', err.message);
  }
}

function startReleaseExpiredHoldsJob() {
  // Chạy mỗi 30 giây — thời gian giữ tạm chỉ 3 phút nên cần quét thường xuyên
  cron.schedule('*/30 * * * * *', releaseExpiredHolds);
  console.log('[cron] Đã bật job giải phóng bàn giữ tạm hết hạn (mỗi 30 giây).');
}

module.exports = { startReleaseExpiredHoldsJob, releaseExpiredHolds };
