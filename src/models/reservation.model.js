const { pool } = require('../config/db');
const { getSetting } = require('../utils/settings');

// Lấy toàn bộ bàn đang trống, sắp xếp tăng dần theo capacity
async function findFreeTables() {
  const [rows] = await pool.query(
    `SELECT id, table_number, capacity FROM restaurant_tables
     WHERE status = 'trong' ORDER BY capacity ASC`
  );
  return rows;
}

// Thuật toán gợi ý bàn: ưu tiên 1 bàn vừa đủ (nhỏ nhất >= party_size),
// nếu không có thì ghép nhiều bàn (ưu tiên bàn lớn trước để ghép ít bàn nhất)
function suggestTableCombo(freeTables, partySize) {
  const singleFit = freeTables.find((t) => t.capacity >= partySize);
  if (singleFit) return [singleFit];

  const descending = [...freeTables].sort((a, b) => b.capacity - a.capacity);
  const combo = [];
  let total = 0;
  for (const table of descending) {
    combo.push(table);
    total += table.capacity;
    if (total >= partySize) return combo;
  }
  return null; // không đủ chỗ dù ghép hết bàn trống
}

async function getHoldMinutes() {
  const value = await getSetting('reservation_hold_minutes', '3');
  return parseInt(value, 10);
}

// Tạo reservation ở trạng thái giu_tam + khóa các bàn liên quan trong 1 transaction.
// table_ids: mảng id bàn do client gửi lên (lấy từ bước gợi ý trước đó).
async function createHold(userId, { partySize, reservationDate, reservationTime, phone, tableIds }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Khóa dòng để tránh 2 khách cùng giữ 1 bàn (race condition)
    const [lockedTables] = await conn.query(
      `SELECT id, capacity, status FROM restaurant_tables WHERE id IN (?) FOR UPDATE`,
      [tableIds]
    );

    if (lockedTables.length !== tableIds.length) {
      const err = new Error('Một số bàn không tồn tại.');
      err.status = 404;
      throw err;
    }
    const notFree = lockedTables.some((t) => t.status !== 'trong');
    if (notFree) {
      const err = new Error('Bàn vừa được người khác giữ, vui lòng chọn lại.');
      err.status = 409;
      throw err;
    }

    const totalCapacity = lockedTables.reduce((sum, t) => sum + t.capacity, 0);
    if (totalCapacity < partySize) {
      const err = new Error('Tổng sức chứa các bàn đã chọn không đủ.');
      err.status = 400;
      throw err;
    }

    const holdMinutes = await getHoldMinutes();

    const [reservationResult] = await conn.query(
      `INSERT INTO reservations (user_id, party_size, reservation_date, reservation_time, phone, status)
       VALUES (?, ?, ?, ?, ?, 'giu_tam')`,
      [userId, partySize, reservationDate, reservationTime, phone]
    );
    const reservationId = reservationResult.insertId;

    const reservationTableValues = tableIds.map((tableId) => [reservationId, tableId]);
    await conn.query(
      `INSERT INTO reservation_tables (reservation_id, table_id) VALUES ?`,
      [reservationTableValues]
    );

    await conn.query(
      `UPDATE restaurant_tables
       SET status = 'giu_tam', locked_by = ?, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE), current_reservation_id = ?
       WHERE id IN (?)`,
      [userId, holdMinutes, reservationId, tableIds]
    );

    await conn.commit();
    return { reservationId, holdMinutes, tableIds };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function findMyReservations(userId) {
  const [rows] = await pool.query(
    `SELECT r.id, r.party_size, r.reservation_date, r.reservation_time, r.phone, r.status,
            r.created_at, r.cancelled_at, r.cancelled_by,
            GROUP_CONCAT(rt.table_id) AS table_ids
     FROM reservations r
     LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
     WHERE r.user_id = ?
     GROUP BY r.id
     ORDER BY r.created_at DESC`,
    [userId]
  );
  return rows;
}

async function findMyReservationById(userId, reservationId) {
  const [rows] = await pool.query(
    `SELECT r.*, GROUP_CONCAT(rt.table_id) AS table_ids
     FROM reservations r
     LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
     WHERE r.id = ? AND r.user_id = ?
     GROUP BY r.id`,
    [reservationId, userId]
  );
  return rows;
}

// ===== Dùng cho cron job giải phóng bàn giữ tạm hết hạn =====

async function findExpiredHeldReservationIds() {
  const [rows] = await pool.query(
    `SELECT DISTINCT current_reservation_id AS id
     FROM restaurant_tables
     WHERE status = 'giu_tam' AND locked_until IS NOT NULL AND locked_until < NOW()
       AND current_reservation_id IS NOT NULL`
  );
  return rows.map((r) => r.id);
}

async function releaseExpiredReservation(reservationId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE restaurant_tables
       SET status = 'trong', locked_by = NULL, locked_until = NULL, current_reservation_id = NULL
       WHERE current_reservation_id = ?`,
      [reservationId]
    );

    await conn.query(
      `UPDATE reservations SET status = 'da_huy', cancelled_at = NOW()
       WHERE id = ? AND status = 'giu_tam'`,
      [reservationId]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  findFreeTables,
  suggestTableCombo,
  createHold,
  findMyReservations,
  findMyReservationById,
  findExpiredHeldReservationIds,
  releaseExpiredReservation,
};
