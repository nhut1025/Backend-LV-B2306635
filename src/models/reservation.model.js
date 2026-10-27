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

async function createHold(userId, {
  partySize, reservationDate, reservationTime, phone, tableIds, preorderItems = [],
}) {
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

    const [reservationResult] = await conn.query(
      `INSERT INTO reservations (user_id, party_size, reservation_date, reservation_time, phone, status)
       VALUES (?, ?, ?, ?, ?, 'giu_tam')`,
      [userId, partySize, reservationDate, reservationTime, phone]
    );
    const reservationId = reservationResult.insertId;

    let depositAmount;
    if (preorderItems.length > 0) {
      await conn.query(
        `INSERT INTO reservation_preorders (reservation_id) VALUES (?)`,
        [reservationId]
      );
      const [dishRows] = await conn.query(
        `SELECT id, price, is_available FROM dishes WHERE id IN (?) FOR UPDATE`,
        [preorderItems.map((item) => item.dishId)]
      );
      if (dishRows.length !== preorderItems.length) {
        const err = new Error('Một số món đặt trước không tồn tại.');
        err.status = 404;
        throw err;
      }
      const dishById = new Map(dishRows.map((dish) => [dish.id, dish]));
      const unavailable = dishRows.some((dish) => !dish.is_available);
      if (unavailable) {
        const err = new Error('Một số món đặt trước hiện không còn phục vụ.');
        err.status = 409;
        throw err;
      }
      const preorderTotal = preorderItems.reduce(
        (total, item) => total + Number(dishById.get(item.dishId).price) * item.quantity,
        0
      );
      depositAmount = Math.round(preorderTotal / 2);
      const itemValues = preorderItems.map((item) => [
        reservationId,
        item.dishId,
        item.quantity,
        dishById.get(item.dishId).price,
        item.note || null,
      ]);
      await conn.query(
        `INSERT INTO reservation_preorder_items
          (reservation_id, dish_id, quantity, unit_price, note)
         VALUES ?`,
        [itemValues]
      );
    } else {
      depositAmount = await getSetting('deposit_amount', '50000');
    }

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

async function findMyPreorder(userId, reservationId) {
  const [headers] = await pool.query(
    `SELECT rp.reservation_id, rp.contact_status, rp.contacted_at,
            rp.preparation_status, rp.prepared_at
     FROM reservation_preorders rp
     JOIN reservations r ON r.id = rp.reservation_id
     WHERE rp.reservation_id = ? AND r.user_id = ?`,
    [reservationId, userId]
  );
  if (headers.length === 0) return null;

  const [items] = await pool.query(
    `SELECT rpi.id, rpi.dish_id, d.name AS dish_name, rpi.quantity,
            rpi.unit_price, rpi.note
     FROM reservation_preorder_items rpi
     JOIN dishes d ON d.id = rpi.dish_id
     WHERE rpi.reservation_id = ?
     ORDER BY rpi.id ASC`,
    [reservationId]
  );
  return { ...headers[0], items };
}

async function findPendingPreorders() {
  const [rows] = await pool.query(
    `SELECT rp.reservation_id, rp.contact_status, rp.contacted_at,
            rp.preparation_status, r.party_size, r.reservation_date,
            r.reservation_time, r.phone, u.full_name AS customer_name,
            GROUP_CONCAT(DISTINCT t.table_number ORDER BY t.table_number) AS table_numbers
     FROM reservation_preorders rp
     JOIN reservations r ON r.id = rp.reservation_id
     JOIN users u ON u.id = r.user_id
     LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
     LEFT JOIN restaurant_tables t ON t.id = rt.table_id
     WHERE r.status = 'da_dat'
       AND rp.preparation_status = 'cho_xac_nhan'
       AND rp.contact_status <> 'tu_choi'
     GROUP BY rp.reservation_id, rp.contact_status, rp.contacted_at,
              rp.preparation_status, r.party_size, r.reservation_date,
              r.reservation_time, r.phone, u.full_name
     ORDER BY r.reservation_date ASC, r.reservation_time ASC`
  );
  if (rows.length === 0) return [];

  const reservationIds = rows.map((row) => row.reservation_id);
  const [items] = await pool.query(
    `SELECT rpi.reservation_id, rpi.id, rpi.dish_id, d.name AS dish_name,
            rpi.quantity, rpi.unit_price, rpi.note
     FROM reservation_preorder_items rpi
     JOIN dishes d ON d.id = rpi.dish_id
     WHERE rpi.reservation_id IN (?)
     ORDER BY rpi.id ASC`,
    [reservationIds]
  );
  const itemsByReservation = new Map(reservationIds.map((id) => [id, []]));
  for (const item of items) itemsByReservation.get(item.reservation_id).push(item);
  return rows.map((row) => ({
    ...row,
    items: itemsByReservation.get(row.reservation_id),
  }));
}

async function recordPreorderContact(reservationId, cashierId, result) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [reservationRows] = await conn.query(
      `SELECT status FROM reservations WHERE id = ? FOR UPDATE`,
      [reservationId]
    );
    if (reservationRows.length === 0) {
      const err = new Error('Không tìm thấy đặt bàn này.');
      err.status = 404;
      throw err;
    }
    if (reservationRows[0].status !== 'da_dat') {
      const err = new Error('Chỉ có thể liên hệ xác nhận món với đặt bàn đã được xác nhận.');
      err.status = 409;
      throw err;
    }
    const [preorderRows] = await conn.query(
      `SELECT preparation_status FROM reservation_preorders
       WHERE reservation_id = ? FOR UPDATE`,
      [reservationId]
    );
    if (preorderRows.length === 0) {
      const err = new Error('Đặt bàn này không có món đặt trước.');
      err.status = 404;
      throw err;
    }
    if (preorderRows[0].preparation_status !== 'cho_xac_nhan') {
      const err = new Error('Món đặt trước đã được đưa vào bill.');
      err.status = 409;
      throw err;
    }
    await conn.query(
      `UPDATE reservation_preorders
       SET contact_status = ?, contacted_at = NOW(), contacted_by = ?
       WHERE reservation_id = ?`,
      [result, cashierId, reservationId]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function preparePreorder(reservationId, cashierId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [reservationRows] = await conn.query(
      `SELECT id, status FROM reservations WHERE id = ? FOR UPDATE`,
      [reservationId]
    );
    if (reservationRows.length === 0) {
      const err = new Error('Không tìm thấy đặt bàn này.');
      err.status = 404;
      throw err;
    }
    if (reservationRows[0].status !== 'da_dat') {
      const err = new Error('Chỉ có thể xác nhận làm món cho đặt bàn đã được xác nhận.');
      err.status = 409;
      throw err;
    }

    const [preorderRows] = await conn.query(
      `SELECT contact_status, preparation_status
       FROM reservation_preorders WHERE reservation_id = ? FOR UPDATE`,
      [reservationId]
    );
    if (preorderRows.length === 0) {
      const err = new Error('Đặt bàn này không có món đặt trước.');
      err.status = 404;
      throw err;
    }
    if (preorderRows[0].preparation_status === 'da_dua_vao_bill') {
      const [billRows] = await conn.query(
        `SELECT id FROM bills WHERE reservation_id = ?
         ORDER BY CASE WHEN status = 'mo' THEN 0 ELSE 1 END, id ASC LIMIT 1`,
        [reservationId]
      );
      await conn.commit();
      return { alreadyPrepared: true, billId: billRows[0] ? billRows[0].id : null, items: [] };
    }
    if (preorderRows[0].contact_status !== 'da_xac_nhan') {
      const err = new Error('Ghi nhận khách đồng ý qua điện thoại trước khi xác nhận làm món.');
      err.status = 409;
      throw err;
    }

    const [preorderItems] = await conn.query(
      `SELECT rpi.id, rpi.dish_id, rpi.quantity, rpi.unit_price, rpi.note,
              d.is_available
       FROM reservation_preorder_items rpi
       JOIN dishes d ON d.id = rpi.dish_id
       WHERE rpi.reservation_id = ?
       ORDER BY rpi.id ASC FOR UPDATE`,
      [reservationId]
    );
    if (preorderItems.length === 0) {
      const err = new Error('Đặt bàn chưa có món đặt trước.');
      err.status = 409;
      throw err;
    }
    if (preorderItems.some((item) => !item.is_available)) {
      const err = new Error('Có món đặt trước hiện không còn phục vụ; vui lòng xử lý lại với khách.');
      err.status = 409;
      throw err;
    }

    const [tableRows] = await conn.query(
      `SELECT rt.table_id
       FROM reservation_tables rt
       JOIN restaurant_tables t ON t.id = rt.table_id
       WHERE rt.reservation_id = ?
       ORDER BY rt.table_id ASC
       LIMIT 1`,
      [reservationId]
    );
    if (tableRows.length === 0) {
      const err = new Error('Không tìm thấy bàn gắn với đặt bàn này.');
      err.status = 409;
      throw err;
    }

    const [existingBills] = await conn.query(
      `SELECT id, payment_method FROM bills WHERE reservation_id = ? AND status = 'mo'
       ORDER BY id ASC LIMIT 1 FOR UPDATE`,
      [reservationId]
    );
    let billId;
    if (existingBills.length > 0) {
      if (existingBills[0].payment_method) {
        const err = new Error('Bill đang chờ thanh toán, không thể thêm món đặt trước.');
        err.status = 409;
        throw err;
      }
      billId = existingBills[0].id;
    } else {
      const [billResult] = await conn.query(
        `INSERT INTO bills (table_id, reservation_id, status) VALUES (?, ?, 'mo')`,
        [tableRows[0].table_id, reservationId]
      );
      billId = billResult.insertId;
    }

    const billItemValues = preorderItems.map((item) => [
      billId,
      item.dish_id,
      item.quantity,
      item.unit_price,
      item.note,
    ]);
    const [insertResult] = await conn.query(
      `INSERT INTO bill_items (bill_id, dish_id, quantity, unit_price, status, note)
       VALUES ?`,
      [billItemValues.map(([id, dishId, quantity, price, note]) => [
        id, dishId, quantity, price, 'cho_xac_nhan', note,
      ])]
    );
    const itemIds = Array.from(
      { length: preorderItems.length },
      (_, index) => insertResult.insertId + index
    );
    const [kitchenItems] = await conn.query(
      `SELECT bi.id, bi.bill_id, bi.dish_id, d.name AS dish_name, bi.quantity,
              bi.status, bi.note, bi.created_at, t.table_number
       FROM bill_items bi
       JOIN dishes d ON d.id = bi.dish_id
       JOIN bills b ON b.id = bi.bill_id
       JOIN restaurant_tables t ON t.id = b.table_id
       WHERE bi.id IN (?) AND bi.deleted_at IS NULL
       ORDER BY bi.id ASC`,
      [itemIds]
    );
    if (kitchenItems.length !== itemIds.length) {
      const err = new Error('Không thể tải đầy đủ món đặt trước vừa thêm vào bill.');
      err.status = 500;
      throw err;
    }
    await conn.query(
      `UPDATE reservation_preorders
       SET preparation_status = 'da_dua_vao_bill', prepared_at = NOW(), prepared_by = ?
       WHERE reservation_id = ?`,
      [cashierId, reservationId]
    );

    await conn.commit();
    return { alreadyPrepared: false, billId, items: kitchenItems };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function findMyReservations(userId) {
  const cancellationDeadlineMinutes = Number.parseInt(
    await getSetting('cancellation_deadline_minutes', '45'),
    10
  );
  if (!Number.isInteger(cancellationDeadlineMinutes) || cancellationDeadlineMinutes < 0) {
    throw new Error('Cấu hình cancellation_deadline_minutes không hợp lệ.');
  }
  const [rows] = await pool.query(
    `SELECT r.id, r.party_size, r.reservation_date, r.reservation_time, r.phone, r.status,
            r.created_at, r.cancelled_at, r.cancelled_by,
            GROUP_CONCAT(rt.table_id) AS table_ids,
            d.status AS deposit_status, d.amount AS deposit_amount,
            CASE WHEN d.status = 'da_coc'
                   AND TIMESTAMP(r.reservation_date, r.reservation_time) >= DATE_ADD(NOW(), INTERVAL ? MINUTE)
                 THEN 1 ELSE 0 END AS cancel_refund_eligible,
            COALESCE(rp.preparation_status = 'da_dua_vao_bill', 0) AS preorder_prepared
     FROM reservations r
     LEFT JOIN deposits d ON d.reservation_id = r.id
     LEFT JOIN reservation_preorders rp ON rp.reservation_id = r.id
     LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
     WHERE r.user_id = ?
     GROUP BY r.id
     ORDER BY r.created_at DESC`,
    [cancellationDeadlineMinutes, userId]
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
  const cancellationDeadlineMinutes = Number.parseInt(
    await getSetting('cancellation_deadline_minutes', '45'),
    10
  );
  if (!Number.isInteger(cancellationDeadlineMinutes) || cancellationDeadlineMinutes < 0) {
    throw new Error('Cấu hình cancellation_deadline_minutes không hợp lệ.');
  }
  const [rows] = await pool.query(
    `SELECT r.id, r.party_size, r.reservation_date, r.reservation_time, r.phone,
            u.full_name AS customer_name,
            GROUP_CONCAT(rt.table_id) AS table_ids,
            GROUP_CONCAT(t.table_number) AS table_numbers,
            CASE WHEN d.status = 'da_coc'
                   AND TIMESTAMP(r.reservation_date, r.reservation_time) >= DATE_ADD(NOW(), INTERVAL ? MINUTE)
                 THEN 1 ELSE 0 END AS cancel_refund_eligible,
            COALESCE(rp.preparation_status = 'da_dua_vao_bill', 0) AS preorder_prepared
     FROM reservations r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN deposits d ON d.reservation_id = r.id
     LEFT JOIN reservation_preorders rp ON rp.reservation_id = r.id
     LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
     LEFT JOIN restaurant_tables t ON t.id = rt.table_id
     WHERE r.status = 'da_dat'
       AND EXISTS (
         SELECT 1
         FROM restaurant_tables active_table
         WHERE active_table.current_reservation_id = r.id
           AND active_table.status = 'da_dat'
       )
     GROUP BY r.id
     ORDER BY r.reservation_date ASC, r.reservation_time ASC`,
    [cancellationDeadlineMinutes]
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

async function cancelReservation(reservationId, {
  actor, userId, refundBankCode, refundAccountNumber, refundAccountName, acceptForfeiture,
}) {
  const cancellationDeadlineMinutes = Number.parseInt(
    await getSetting('cancellation_deadline_minutes', '45'),
    10
  );
  if (!Number.isInteger(cancellationDeadlineMinutes) || cancellationDeadlineMinutes < 0) {
    throw new Error('Cấu hình cancellation_deadline_minutes không hợp lệ.');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [depositRows] = await conn.query(
      `SELECT id, status, amount FROM deposits WHERE reservation_id = ? FOR UPDATE`,
      [reservationId]
    );
    const [reservationRows] = await conn.query(
      `SELECT id, user_id, status,
              TIMESTAMP(reservation_date, reservation_time) >= DATE_ADD(NOW(), INTERVAL ? MINUTE)
                AS refund_eligible
       FROM reservations WHERE id = ? FOR UPDATE`,
      [cancellationDeadlineMinutes, reservationId]
    );
    if (reservationRows.length === 0) {
      const err = new Error('Không tìm thấy đặt bàn này.');
      err.status = 404;
      throw err;
    }

    const reservation = reservationRows[0];
    if (actor === 'customer' && Number(reservation.user_id) !== Number(userId)) {
      const err = new Error('Không tìm thấy đặt bàn này.');
      err.status = 404;
      throw err;
    }
    if (!['giu_tam', 'da_dat'].includes(reservation.status)) {
      const err = new Error('Chỉ có thể hủy đơn đang ở trạng thái giữ tạm hoặc đã đặt.');
      err.status = 409;
      throw err;
    }
    if (depositRows.length === 0) {
      const err = new Error('Không tìm thấy thông tin cọc cho đơn đặt bàn này.');
      err.status = 409;
      throw err;
    }

    const [tableRows] = await conn.query(
      `SELECT id, status FROM restaurant_tables WHERE current_reservation_id = ? FOR UPDATE`,
      [reservationId]
    );
    if (tableRows.some((table) => table.status === 'co_khach')) {
      const err = new Error('Không thể hủy đặt bàn sau khi đã xác nhận khách đến.');
      err.status = 409;
      throw err;
    }

    const [preorderRows] = await conn.query(
      `SELECT preparation_status FROM reservation_preorders WHERE reservation_id = ? FOR UPDATE`,
      [reservationId]
    );
    if (preorderRows.some((preorder) => preorder.preparation_status === 'da_dua_vao_bill')) {
      const err = new Error('Không thể hủy vì món đặt trước đã được đưa vào bill và gửi xuống bếp.');
      err.status = 409;
      throw err;
    }

    const deposit = depositRows[0];
    let refundEligible = false;
    let depositStatus;
    if (reservation.status === 'giu_tam') {
      if (deposit.status !== 'cho_thanh_toan') {
        const err = new Error('Trạng thái cọc không còn phù hợp để hủy lượt giữ bàn.');
        err.status = 409;
        throw err;
      }
      depositStatus = 'da_huy';
      await conn.query(
        `UPDATE deposits SET status = 'da_huy' WHERE id = ?`,
        [deposit.id]
      );
    } else {
      if (deposit.status !== 'da_coc') {
        const err = new Error('Cọc không ở trạng thái hợp lệ để hủy đặt bàn.');
        err.status = 409;
        throw err;
      }

      refundEligible = Boolean(Number(reservation.refund_eligible));
      if (refundEligible) {
        const bankCode = typeof refundBankCode === 'string' ? refundBankCode.trim() : '';
        const accountNumber = typeof refundAccountNumber === 'string' ? refundAccountNumber.trim() : '';
        const accountName = typeof refundAccountName === 'string' ? refundAccountName.trim() : '';
        if (!bankCode || bankCode.length > 20 || !accountNumber || accountNumber.length > 50
          || !accountName || accountName.length > 100) {
          const err = new Error('Vui lòng nhập ngân hàng, số tài khoản và tên chủ tài khoản hợp lệ để nhận hoàn cọc.');
          err.status = 400;
          throw err;
        }
        depositStatus = 'dang_hoan';
        await conn.query(
          `UPDATE deposits
           SET status = 'dang_hoan', refund_bank_code = ?,
               refund_account_number = ?, refund_account_name = ?
           WHERE id = ?`,
          [bankCode, accountNumber, accountName, deposit.id]
        );
      } else {
        if (!acceptForfeiture) {
          const err = new Error('Đơn đã quá thời hạn hoàn cọc. Hãy xác nhận đồng ý mất cọc để tiếp tục hủy.');
          err.status = 409;
          throw err;
        }
        depositStatus = 'mat_coc';
        await conn.query(
          `UPDATE deposits SET status = 'mat_coc', forfeited_at = NOW() WHERE id = ?`,
          [deposit.id]
        );
      }
    }

    await conn.query(
      `UPDATE restaurant_tables
       SET status = 'trong', locked_by = NULL, locked_until = NULL, current_reservation_id = NULL
       WHERE current_reservation_id = ?`,
      [reservationId]
    );

    await conn.query(
      `UPDATE reservations
       SET status = 'da_huy', cancelled_at = NOW(), cancelled_by = ?
       WHERE id = ? AND status IN ('giu_tam', 'da_dat')`,
      [actor, reservationId]
    );

    await conn.commit();
    return {
      reservationId,
      cancelled: true,
      refundEligible,
      depositStatus,
      depositAmount: Number(deposit.amount),
    };
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

    const [depositRows] = await conn.query(
      `SELECT id, status FROM deposits WHERE reservation_id = ? FOR UPDATE`,
      [reservationId]
    );
    const [reservationRows] = await conn.query(
      `SELECT id, status FROM reservations WHERE id = ? FOR UPDATE`,
      [reservationId]
    );
    if (reservationRows.length === 0 || reservationRows[0].status !== 'giu_tam'
      || depositRows.length === 0 || depositRows[0].status !== 'cho_thanh_toan') {
      await conn.rollback();
      return false;
    }

    const [tableRows] = await conn.query(
      `SELECT id, status, locked_until < NOW() AS is_expired FROM restaurant_tables
       WHERE current_reservation_id = ? FOR UPDATE`,
      [reservationId]
    );
    if (!tableRows.some((table) => table.status === 'giu_tam' && Number(table.is_expired))) {
      await conn.rollback();
      return false;
    }

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
    await conn.query(
      `UPDATE deposits SET status = 'da_huy' WHERE id = ?`,
      [depositRows[0].id]
    );

    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function findNoShowReservationIds() {
  const bufferMinutes = Number.parseInt(await getSetting('no_show_buffer_minutes', '15'), 10);
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0) {
    throw new Error('Cấu hình no_show_buffer_minutes không hợp lệ.');
  }
  const [rows] = await pool.query(
    `SELECT r.id
     FROM reservations r
     WHERE r.status = 'da_dat'
       AND DATE_ADD(TIMESTAMP(r.reservation_date, r.reservation_time), INTERVAL ? MINUTE) <= NOW()
       AND EXISTS (
         SELECT 1 FROM restaurant_tables t
         WHERE t.current_reservation_id = r.id AND t.status = 'da_dat'
       )
       AND NOT EXISTS (
         SELECT 1 FROM restaurant_tables arrived
         WHERE arrived.current_reservation_id = r.id AND arrived.status = 'co_khach'
       )
     ORDER BY r.id ASC`,
    [bufferMinutes]
  );
  return rows.map((row) => row.id);
}

async function markReservationNoShow(reservationId) {
  const bufferMinutes = Number.parseInt(await getSetting('no_show_buffer_minutes', '15'), 10);
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0) {
    throw new Error('Cấu hình no_show_buffer_minutes không hợp lệ.');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [depositRows] = await conn.query(
      `SELECT id, status FROM deposits WHERE reservation_id = ? FOR UPDATE`,
      [reservationId]
    );
    const [reservationRows] = await conn.query(
      `SELECT id, status,
              DATE_ADD(TIMESTAMP(reservation_date, reservation_time), INTERVAL ? MINUTE) <= NOW()
                AS no_show_due
       FROM reservations WHERE id = ? FOR UPDATE`,
      [bufferMinutes, reservationId]
    );
    if (reservationRows.length === 0 || reservationRows[0].status !== 'da_dat'
      || !Number(reservationRows[0].no_show_due)) {
      await conn.rollback();
      return false;
    }

    const [tableRows] = await conn.query(
      `SELECT id, status FROM restaurant_tables WHERE current_reservation_id = ? FOR UPDATE`,
      [reservationId]
    );
    if (!tableRows.some((table) => table.status === 'da_dat')
      || tableRows.some((table) => table.status === 'co_khach')) {
      await conn.rollback();
      return false;
    }

    if (depositRows.length > 0 && depositRows[0].status === 'da_coc') {
      await conn.query(
        `UPDATE deposits SET status = 'mat_coc', forfeited_at = NOW() WHERE id = ?`,
        [depositRows[0].id]
      );
    }
    await conn.query(
      `UPDATE reservations SET status = 'qua_han' WHERE id = ? AND status = 'da_dat'`,
      [reservationId]
    );
    await conn.query(
      `UPDATE restaurant_tables
       SET status = 'trong', locked_by = NULL, locked_until = NULL, current_reservation_id = NULL
       WHERE current_reservation_id = ?`,
      [reservationId]
    );

    await conn.commit();
    return true;
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

async function findPendingRefunds() {
  const [rows] = await pool.query(
    `SELECT d.id AS deposit_id, d.reservation_id, d.amount,
            d.refund_bank_code, d.refund_account_number, d.refund_account_name,
            d.paid_at, r.party_size, r.reservation_date, r.reservation_time, r.phone,
            u.full_name AS customer_name,
            GROUP_CONCAT(t.table_number ORDER BY t.table_number) AS table_numbers
     FROM deposits d
     JOIN reservations r ON r.id = d.reservation_id
     JOIN users u ON u.id = r.user_id
     LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
     LEFT JOIN restaurant_tables t ON t.id = rt.table_id
     WHERE d.status = 'dang_hoan'
     GROUP BY d.id
     ORDER BY r.cancelled_at ASC`
  );
  return rows;
}

async function confirmRefund(reservationId, managerId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [depositRows] = await conn.query(
      `SELECT id, status FROM deposits WHERE reservation_id = ? FOR UPDATE`,
      [reservationId]
    );
    if (depositRows.length === 0) {
      const err = new Error('Không tìm thấy cọc cần hoàn cho đơn này.');
      err.status = 404;
      throw err;
    }
    if (depositRows[0].status !== 'dang_hoan') {
      const err = new Error('Cọc này không còn ở trạng thái chờ hoàn.');
      err.status = 409;
      throw err;
    }
    await conn.query(
      `UPDATE deposits SET status = 'da_hoan', refunded_at = NOW(), refunded_by = ?
       WHERE id = ?`,
      [managerId, depositRows[0].id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function confirmDeposit(reservationId, cashierId) {
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
      `UPDATE deposits SET status = 'da_coc', paid_at = NOW(), confirmed_by = ? WHERE reservation_id = ?`,
      [cashierId, reservationId]
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
  findMyPreorder,
  findPendingPreorders,
  recordPreorderContact,
  preparePreorder,
  findMyReservations,
  findMyReservationById,
  findExpiredHeldReservationIds,
  releaseExpiredReservation,
  findNoShowReservationIds,
  markReservationNoShow,
  findDepositByReservationId,
  findPendingDeposits,
  findPendingRefunds,
  confirmRefund,
  confirmDeposit,
  findUpcomingReservations,
  confirmArrival,
  cancelReservation,
};