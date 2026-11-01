const { pool } = require('../config/db');
const { getSetting } = require('../utils/settings');

function createConflict(message, status = 409) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeTableIds(tableIds) {
  if (!Array.isArray(tableIds) || tableIds.length === 0 || tableIds.length > 50) {
    throw createConflict('Danh sách bàn chuyển đến không hợp lệ.', 400);
  }
  const normalized = tableIds.map(Number);
  if (normalized.some((id) => !Number.isSafeInteger(id) || id <= 0)
    || new Set(normalized).size !== normalized.length) {
    throw createConflict('Danh sách bàn chuyển đến không hợp lệ.', 400);
  }
  return normalized;
}

async function getTransferDurationMinutes() {
  const value = Number.parseInt(await getSetting('table_transfer_duration_minutes', '120'), 10);
  if (!Number.isInteger(value) || value < 15 || value > 1440) {
    throw new Error('Cấu hình table_transfer_duration_minutes phải nằm trong khoảng 15–1440.');
  }
  return value;
}

async function findConflictingReservation(conn, targetTableIds, reservation, durationMinutes, isOccupied) {
  const [rows] = await conn.query(
    `SELECT DISTINCT r.id
     FROM reservations r
     JOIN reservation_tables rt ON rt.reservation_id = r.id
     WHERE rt.table_id IN (?)
       AND r.status = 'da_dat'
       AND (? IS NULL OR r.id <> ?)
       AND TIMESTAMP(r.reservation_date, r.reservation_time) < ${
    isOccupied
      ? 'DATE_ADD(NOW(), INTERVAL ? MINUTE)'
      : 'DATE_ADD(GREATEST(TIMESTAMP(?, ?), NOW()), INTERVAL ? MINUTE)'
  }
       AND DATE_ADD(TIMESTAMP(r.reservation_date, r.reservation_time), INTERVAL ? MINUTE) > ${
    isOccupied ? 'NOW()' : 'GREATEST(TIMESTAMP(?, ?), NOW())'
  }
     LIMIT 1`,
    isOccupied
      ? [targetTableIds, reservation?.id ?? null, reservation?.id ?? null, durationMinutes, durationMinutes]
      : [
        targetTableIds,
        reservation?.id ?? null,
        reservation?.id ?? null,
        reservation.reservation_date,
        reservation.reservation_time,
        durationMinutes,
        durationMinutes,
        reservation.reservation_date,
        reservation.reservation_time,
      ]
  );
  return rows[0] || null;
}

async function findBills(conn, { reservationId, sourceTableIds }) {
  const [allBills] = reservationId === null
    ? await conn.query(
      `SELECT id, table_id, status, payment_method
       FROM bills
       WHERE table_id IN (?) AND status = 'mo'
       ORDER BY id
       FOR UPDATE`,
      [sourceTableIds]
    )
    : await conn.query(
      `SELECT id, table_id, status, payment_method
       FROM bills
      WHERE reservation_id = ?
         OR (reservation_id IS NULL AND table_id IN (?) AND status = 'mo')
       ORDER BY id
       FOR UPDATE`,
      [reservationId, sourceTableIds]
    );
  return allBills;
}

async function transferTables({ reservationId = null, sourceTableId = null, targetTableIds, staffId }) {
  const targets = normalizeTableIds(targetTableIds);
  if (reservationId !== null && (!Number.isSafeInteger(Number(reservationId)) || Number(reservationId) <= 0)) {
    throw createConflict('Mã đặt bàn không hợp lệ.', 400);
  }
  if (reservationId === null
    && (!Number.isSafeInteger(Number(sourceTableId)) || Number(sourceTableId) <= 0)) {
    throw createConflict('Mã bàn hiện tại không hợp lệ.', 400);
  }
  if (reservationId === null && targets.length !== 1) {
    throw createConflict('Khách vãng lai chỉ có thể chuyển đến một bàn.', 400);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let reservation = null;
    let sourceIds;
    if (reservationId !== null) {
      const [reservationRows] = await conn.query(
        `SELECT id, status, party_size, reservation_date, reservation_time
         FROM reservations WHERE id = ?`,
        [reservationId]
      );
      reservation = reservationRows[0];
      if (!reservation || reservation.status !== 'da_dat') {
        throw createConflict('Chỉ có thể chuyển bàn cho đặt chỗ đã xác nhận.');
      }

      const [reservationTables] = await conn.query(
        `SELECT table_id FROM reservation_tables WHERE reservation_id = ? ORDER BY table_id`,
        [reservationId]
      );
      sourceIds = reservationTables.map((row) => Number(row.table_id));
      if (sourceIds.length === 0) {
        throw createConflict('Không tìm thấy bàn đang gắn với đặt chỗ này.');
      }
    } else {
      sourceIds = [Number(sourceTableId)];
    }

    let allBills = await findBills(conn, {
      reservationId,
      sourceTableIds: sourceIds,
    });

    if (reservationId !== null) {
      const [lockedReservations] = await conn.query(
        `SELECT id, status, party_size, reservation_date, reservation_time
         FROM reservations WHERE id = ? FOR UPDATE`,
        [reservationId]
      );
      reservation = lockedReservations[0];
      if (!reservation || reservation.status !== 'da_dat') {
        throw createConflict('Đặt bàn đã thay đổi trạng thái. Vui lòng tải lại dữ liệu.');
      }
      const [currentReservationTables] = await conn.query(
        `SELECT table_id FROM reservation_tables
         WHERE reservation_id = ? ORDER BY table_id FOR UPDATE`,
        [reservationId]
      );
      sourceIds = currentReservationTables.map((row) => Number(row.table_id));
      if (sourceIds.length === 0) {
        throw createConflict('Không tìm thấy bàn đang gắn với đặt chỗ này.');
      }
    }

    const lockIds = [...new Set([...sourceIds, ...targets])].sort((a, b) => a - b);
    const lockedTables = [];
    for (const id of lockIds) {
      const [rows] = await conn.query(
        `SELECT id, table_number, capacity, status, current_reservation_id
         FROM restaurant_tables WHERE id = ? FOR UPDATE`,
        [id]
      );
      if (rows[0]) lockedTables.push(rows[0]);
    }
    if (lockedTables.length !== lockIds.length) {
      throw createConflict('Một số bàn không tồn tại.', 404);
    }
    const tablesById = new Map(lockedTables.map((table) => [Number(table.id), table]));
    const linkedSourceIds = sourceIds;
    if (reservationId !== null) {
      sourceIds = linkedSourceIds.filter((id) => {
        const table = tablesById.get(id);
        return Number(table.current_reservation_id) === Number(reservationId)
          && ['da_dat', 'co_khach'].includes(table.status);
      });
    }
    const sources = sourceIds.map((id) => tablesById.get(id));
    if (sources.length === 0) {
      throw createConflict('Không tìm thấy bàn đang được sử dụng cho đặt chỗ này.');
    }
    const destinationTables = targets.map((id) => tablesById.get(id));

    const occupied = sources.every((table) => table.status === 'co_khach');
    const reserved = sources.every((table) => table.status === 'da_dat');
    if (!occupied && !reserved) {
      throw createConflict(
        reservationId === null
          ? 'Chỉ có thể chuyển khách từ bàn đang có khách.'
          : 'Đặt bàn đang giữ tạm hoặc trạng thái bàn đã thay đổi, không thể chuyển.'
      );
    }

    if (reservationId === null) {
      if (sources[0].current_reservation_id !== null) {
        throw createConflict('Bàn này thuộc một lượt đặt bàn, hãy chuyển từ thông tin đặt bàn.');
      }
      if (targets[0] === sources[0]) {
        throw createConflict('Bàn chuyển đến phải khác bàn hiện tại.', 400);
      }
    } else if (sources.some((table) => Number(table.current_reservation_id) !== Number(reservationId))) {
      throw createConflict('Liên kết bàn của đặt chỗ đã thay đổi. Vui lòng tải lại dữ liệu.');
    }

    const targetIds = targets.slice().sort((a, b) => a - b);
    const sourceSet = new Set(sourceIds);
    if (destinationTables.some((table) => !sourceSet.has(Number(table.id))
      && (table.status !== 'trong' || table.current_reservation_id !== null))) {
      throw createConflict('Một hoặc nhiều bàn chuyển đến không còn trống. Vui lòng chọn lại.');
    }
    if (reservationId !== null) {
      const totalCapacity = destinationTables.reduce((sum, table) => sum + Number(table.capacity), 0);
      if (totalCapacity < Number(reservation.party_size)) {
        throw createConflict('Tổng sức chứa bàn mới không đủ cho số khách đã đặt.', 400);
      }
    }

    if (sourceIds.slice().sort((a, b) => a - b).join(',') === targetIds.join(',')) {
      if (reservationId !== null && linkedSourceIds.length !== sourceIds.length) {
        await conn.query(
          `DELETE FROM reservation_tables WHERE reservation_id = ? AND table_id NOT IN (?)`,
          [reservationId, targetIds]
        );
      }
      await conn.commit();
      return {
        message: 'Các bàn hiện tại đã đúng với lựa chọn.',
        changed: false,
        tableNumbers: destinationTables.map((table) => table.table_number),
        queueItems: [],
        reservationId,
        billId: null,
      };
    }

    if (allBills.length === 0) {
      allBills = await findBills(conn, {
        reservationId,
        sourceTableIds: sourceIds,
      });
    }
    if (allBills.some((bill) => bill.status === 'da_thanh_toan' || bill.payment_method !== null)) {
      throw createConflict('Không thể chuyển bàn vì bill đã yêu cầu thanh toán hoặc đã thanh toán.');
    }
    const openBills = allBills.filter((bill) => bill.status === 'mo');
    if (openBills.length > 1) {
      throw createConflict('Đặt bàn đang có nhiều bill mở. Vui lòng xử lý bill trước khi chuyển bàn.');
    }
    const bill = openBills[0] || null;

    const durationMinutes = await getTransferDurationMinutes();
    const conflict = await findConflictingReservation(
      conn,
      targets,
      reservation,
      durationMinutes,
      occupied
    );
    if (conflict) {
      throw createConflict('Bàn mới đã có đặt bàn khác trong khoảng thời gian sử dụng dự kiến.');
    }

    const representativeId = targetIds[0];
    if (bill) {
      await conn.query(
        `UPDATE bills SET table_id = ? WHERE id = ? AND status = 'mo' AND payment_method IS NULL`,
        [representativeId, bill.id]
      );
    }

    if (reservationId === null) {
      const [releasedSource] = await conn.query(
        `UPDATE restaurant_tables
         SET status = 'trong', locked_by = NULL, locked_until = NULL, current_reservation_id = NULL
         WHERE id = ? AND status = 'co_khach'`,
        [sourceTableId]
      );
      const [occupiedDestination] = await conn.query(
        `UPDATE restaurant_tables
         SET status = 'co_khach', locked_by = NULL, locked_until = NULL, current_reservation_id = NULL
         WHERE id = ? AND status = 'trong'`,
        [representativeId]
      );
      if (releasedSource.affectedRows !== 1 || occupiedDestination.affectedRows !== 1) {
        throw createConflict('Trạng thái bàn đã thay đổi. Không thể hoàn tất chuyển bàn.');
      }
    } else {
      const addedIds = targetIds.filter((id) => !sourceSet.has(id));
      const removedIds = sourceIds.filter((id) => !new Set(targetIds).has(id));

      if (removedIds.length > 0) {
        const [releasedTables] = await conn.query(
          `UPDATE restaurant_tables
           SET status = 'trong', locked_by = NULL, locked_until = NULL, current_reservation_id = NULL
           WHERE id IN (?) AND current_reservation_id = ?`,
          [removedIds, reservationId]
        );
        if (releasedTables.affectedRows !== removedIds.length) {
          throw createConflict('Một số bàn cũ đã thay đổi trạng thái. Không thể hoàn tất chuyển bàn.');
        }
      }
      await conn.query(
        `DELETE FROM reservation_tables WHERE reservation_id = ? AND table_id NOT IN (?)`,
        [reservationId, targetIds]
      );
      if (addedIds.length > 0) {
        await conn.query(
          `INSERT INTO reservation_tables (reservation_id, table_id) VALUES ?`,
          [addedIds.map((id) => [reservationId, id])]
        );
        const [assignedTables] = await conn.query(
          `UPDATE restaurant_tables
           SET status = ?, locked_by = NULL, locked_until = NULL, current_reservation_id = ?
           WHERE id IN (?) AND status = 'trong'`,
          [occupied ? 'co_khach' : 'da_dat', reservationId, addedIds]
        );
        if (assignedTables.affectedRows !== addedIds.length) {
          throw createConflict('Một số bàn đích đã thay đổi trạng thái. Không thể hoàn tất chuyển bàn.');
        }
      }

      const [finalTables] = await conn.query(
        `SELECT rt.table_id, t.status, t.current_reservation_id
         FROM reservation_tables rt
         JOIN restaurant_tables t ON t.id = rt.table_id
         WHERE rt.reservation_id = ?
         ORDER BY rt.table_id`,
        [reservationId]
      );
      if (
        finalTables.length !== targetIds.length
        || finalTables.some((table, index) => (
          Number(table.table_id) !== targetIds[index]
          || Number(table.current_reservation_id) !== Number(reservationId)
          || table.status !== (occupied ? 'co_khach' : 'da_dat')
        ))
      ) {
        throw createConflict('Không thể đồng bộ trạng thái các bàn mới. Giao dịch đã được hủy.');
      }
    }

    const changedFromIds = reservationId === null
      ? [Number(sourceTableId)]
      : sourceIds.filter((id) => !targetIds.includes(id));
    const changedToIds = reservationId === null
      ? [representativeId]
      : targetIds.filter((id) => !sourceSet.has(id));
    if (changedFromIds.length === 0) changedFromIds.push(sourceIds[0]);
    if (changedToIds.length === 0) changedToIds.push(representativeId);
    const transferRows = changedFromIds.map((fromId, index) => [
      reservationId,
      bill?.id || null,
      fromId,
      changedToIds[Math.min(index, changedToIds.length - 1)],
      staffId,
    ]);
    await conn.query(
      `INSERT INTO table_transfers
       (reservation_id, bill_id, from_table_id, to_table_id, moved_by)
       VALUES ?`,
      [transferRows]
    );

    let queueItems = [];
    if (bill) {
      const [items] = await conn.query(
        `SELECT bi.id, bi.bill_id, bi.dish_id, d.name AS dish_name, bi.quantity,
                bi.status, bi.note, bi.created_at, t.table_number
         FROM bill_items bi
         JOIN dishes d ON d.id = bi.dish_id
         JOIN bills b ON b.id = bi.bill_id
         JOIN restaurant_tables t ON t.id = b.table_id
         WHERE bi.bill_id = ? AND bi.deleted_at IS NULL
           AND bi.status IN ('cho_xac_nhan', 'dang_che_bien')`,
        [bill.id]
      );
      queueItems = items;
    }

    await conn.commit();
    return {
      message: `Đã chuyển khách sang bàn ${destinationTables.map((table) => table.table_number).join(' + ')}.`,
      changed: true,
      tableNumbers: destinationTables.map((table) => table.table_number),
      fromTableIds: sourceIds,
      toTableIds: targetIds,
      reservationId,
      billId: bill?.id || null,
      queueItems,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { transferTables };
