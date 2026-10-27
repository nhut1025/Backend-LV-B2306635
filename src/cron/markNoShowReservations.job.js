const cron = require('node-cron');
const reservationModel = require('../models/reservation.model');

async function markNoShowReservations() {
  try {
    const reservationIds = await reservationModel.findNoShowReservationIds();
    for (const reservationId of reservationIds) {
      try {
        const marked = await reservationModel.markReservationNoShow(reservationId);
        if (marked) {
          console.log(`[cron] Đã đánh dấu no-show và giải phóng bàn cho reservation #${reservationId}`);
        }
      } catch (err) {
        console.error(`[cron] Lỗi xử lý no-show reservation #${reservationId}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[cron] Lỗi khi tìm đặt bàn no-show:', err.message);
  }
}

function startMarkNoShowReservationsJob() {
  cron.schedule('*/30 * * * * *', markNoShowReservations);
  console.log('[cron] Đã bật job xử lý đặt bàn no-show (mỗi 30 giây).');
}

module.exports = { startMarkNoShowReservationsJob, markNoShowReservations };
