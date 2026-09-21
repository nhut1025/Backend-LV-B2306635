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
  return null;
}

async function getHoldMinutes() {
  const value = await getSetting('reservation_hold_minutes', '3');
  return parseInt(value, 10);
}

async function createHold(userId, { partySize, reservationDate, reservationTime, phone, tableIds }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

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
    const depositAmount = await getSetting('deposit_amount', '50000');

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

    const transactionCode = `COC${reservationId}`;
    await conn.query(
      `INSERT INTO deposits (reservation_id, amount, status, transaction_code)
       VALUES (?, ?, 'cho_thanh_toan', ?)`,
      [reservationId, depositAmount, transactionCode]
    );

    await conn.commit();
    return { reservationId, holdMinutes, tableIds, depositAmount, transactionCode };
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

// ===== Phase 4: vận hành nhân viên phục vụ =====

// Danh sách đặt bàn đã cọc, đang chờ khách đến — sắp xếp gần nhất lên đầu để NV chuẩn bị trước.
async function findUpcomingReservations() {
  const [rows] = await pool.query(
    `SELECT r.id, r.party_size, r.reservation_date, r.reservation_time, r.phone,
            u.full_name AS customer_name,
            GROUP_CONCAT(rt.table_id) AS table_ids,
            GROUP_CONCAT(t.table_number) AS table_numbers
     FROM reservations r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
     LEFT JOIN restaurant_tables t ON t.id = rt.table_id
     WHERE r.status = 'da_dat'
     GROUP BY r.id
     ORDER BY r.reservation_date ASC, r.reservation_time ASC`
  );
  return rows;
}

// NV xác nhận khách đã đến: mọi bàn trong tổ hợp chuyển da_dat -> co_khach.
// reservations.status GIỮ NGUYÊN 'da_dat' — chỉ chuyển 'hoan_thanh' khi thanh toán xong (Phase 7).
async function confirmArrival(reservationId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [reservationRows] = await conn.query(
      `SELECT id, status FROM reservations WHERE id = ? FOR UPDATE`,
      [reservationId]
    );
    if (reservationRows.length === 0 || reservationRows[0].status !== 'da_dat') {
      const err = new Error('Đơn đặt bàn không ở trạng thái đã đặt (có thể chưa cọc hoặc đã hoàn tất).');
      err.status = 409;
      throw err;
    }

    const [result] = await conn.query(
      `UPDATE restaurant_tables SET status = 'co_khach'
       WHERE current_reservation_id = ? AND status = 'da_dat'`,
      [reservationId]
    );
    if (result.affectedRows === 0) {
      const err = new Error('Không tìm thấy bàn nào ở trạng thái đã đặt cho đơn này.');
      err.status = 409;
      throw err;
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ===== Dùng cho cron job giải phóng bàn giữ tạm hết hạn =====

// Chỉ lấy những đơn quá hạn giữ MÀ cọc vẫn đang "cho_thanh_toan" — nếu thu ngân
// đã xác nhận đúng lúc cron chuẩn bị chạy (deposit đã sang da_coc), bỏ qua, không hủy nhầm.
async function findExpiredHeldReservationIds() {
  const [rows] = await pool.query(
    `SELECT DISTINCT t.current_reservation_id AS id
     FROM restaurant_tables t
     JOIN deposits d ON d.reservation_id = t.current_reservation_id
     WHERE t.status = 'giu_tam' AND t.locked_until IS NOT NULL AND t.locked_until < NOW()
       AND t.current_reservation_id IS NOT NULL
       AND d.status = 'cho_thanh_toan'`
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

// ===== Phase 3: thanh toán cọc qua VietQR =====

async function findDepositByReservationId(reservationId, userId) {
  const [rows] = await pool.query(
    `SELECT d.id, d.reservation_id, d.amount, d.status, d.transaction_code, d.paid_at
     FROM deposits d
     JOIN reservations r ON r.id = d.reservation_id
     WHERE d.reservation_id = ? AND r.user_id = ?`,
    [reservationId, userId]
  );
  return rows;
}

async function findPendingDeposits() {
  const [rows] = await pool.query(
    `SELECT d.id AS deposit_id, d.reservation_id, d.amount, d.transaction_code, d.status,
            r.party_size, r.reservation_date, r.reservation_time, r.phone,
            u.full_name AS customer_name,
            GROUP_CONCAT(rt2.table_id) AS table_ids,
            GROUP_CONCAT(t.table_number) AS table_numbers
     FROM deposits d
     JOIN reservations r ON r.id = d.reservation_id
     JOIN users u ON u.id = r.user_id
     LEFT JOIN reservation_tables rt2 ON rt2.reservation_id = r.id
     LEFT JOIN restaurant_tables t ON t.id = rt2.table_id
     WHERE d.status = 'cho_thanh_toan' AND r.status = 'giu_tam'
     GROUP BY d.id
     ORDER BY r.created_at ASC`
  );
  return rows;
}

async function confirmDeposit(reservationId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [depositRows] = await conn.query(
      `SELECT id, status FROM deposits WHERE reservation_id = ? FOR UPDATE`,
      [reservationId]
    );
    if (depositRows.length === 0) {
      const err = new Error('Không tìm thấy cọc cho đơn đặt bàn này.');
      err.status = 404;
      throw err;
    }
    if (depositRows[0].status !== 'cho_thanh_toan') {
      const err = new Error('Cọc này không ở trạng thái chờ thanh toán (có thể đã xác nhận hoặc đã huỷ).');
      err.status = 409;
      throw err;
    }

    const [reservationRows] = await conn.query(
      `SELECT id, status FROM reservations WHERE id = ? FOR UPDATE`,
      [reservationId]
    );
    if (reservationRows.length === 0 || reservationRows[0].status !== 'giu_tam') {
      const err = new Error('Đơn đặt bàn không ở trạng thái giữ tạm (có thể đã hết hạn hoặc đã huỷ).');
      err.status = 409;
      throw err;
    }

    await conn.query(
      `UPDATE deposits SET status = 'da_coc', paid_at = NOW() WHERE reservation_id = ?`,
      [reservationId]
    );

    await conn.query(
      `UPDATE reservations SET status = 'da_dat' WHERE id = ?`,
      [reservationId]
    );

    await conn.query(
      `UPDATE restaurant_tables
       SET status = 'da_dat', locked_by = NULL, locked_until = NULL
       WHERE current_reservation_id = ?`,
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
  findDepositByReservationId,
  findPendingDeposits,
  confirmDeposit,
  findUpcomingReservations,
  confirmArrival,
};