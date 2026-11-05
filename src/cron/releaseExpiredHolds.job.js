const reservationModel = require('../models/reservation.model');
const { getSetting } = require('../utils/settings');

const DEFAULT_SCAN_SECONDS = 30;
let scanTimeout = null;
let jobStarted = false;
let scheduleGeneration = 0;

async function releaseExpiredHolds() {
  try {
    const expiredIds = await reservationModel.findExpiredHeldReservationIds();
    for (const reservationId of expiredIds) {
      const released = await reservationModel.releaseExpiredReservation(reservationId);
      if (released) {
        console.log(`[cron] Đã giải phóng bàn giữ tạm hết hạn cho reservation #${reservationId}`);
      }
    }
  } catch (err) {
    console.error('[cron] Lỗi khi giải phóng bàn giữ tạm hết hạn:', err.message);
  }
}

function startReleaseExpiredHoldsJob() {
  if (jobStarted) return;
  jobStarted = true;
  scheduleGeneration += 1;
  scheduleNextScan(scheduleGeneration);
  console.log('[cron] Đã bật job giải phóng bàn giữ tạm hết hạn.');
}

async function scheduleNextScan(generation) {
  if (!jobStarted || generation !== scheduleGeneration) return;

  let intervalSeconds;
  try {
    intervalSeconds = Number(await getSetting('reservation_hold_scan_seconds', String(DEFAULT_SCAN_SECONDS)));
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < 5 || intervalSeconds > 300) {
      throw new Error('Cấu hình reservation_hold_scan_seconds phải nằm trong khoảng 5–300 giây.');
    }
  } catch (err) {
    console.error('[cron] Không thể đọc chu kỳ quét giữ bàn:', err.message);
    scanTimeout = setTimeout(() => scheduleNextScan(generation), DEFAULT_SCAN_SECONDS * 1000);
    return;
  }

  if (!jobStarted || generation !== scheduleGeneration) return;
  scanTimeout = setTimeout(async () => {
    await releaseExpiredHolds();
    scheduleNextScan(generation);
  }, intervalSeconds * 1000);
}

function refreshReleaseExpiredHoldsSchedule() {
  if (!jobStarted) return;
  scheduleGeneration += 1;
  clearTimeout(scanTimeout);
  scheduleNextScan(scheduleGeneration);
}

module.exports = {
  startReleaseExpiredHoldsJob,
  refreshReleaseExpiredHoldsSchedule,
  releaseExpiredHolds,
};
