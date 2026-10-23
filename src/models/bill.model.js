const { pool } = require('../config/db');

// Lấy bill đang mở (status='mo') của 1 bàn, nếu có
async function findOpenBillByTableId(tableId) {
  const [rows] = await pool.query(
    `SELECT * FROM bills WHERE table_id = ? AND status = 'mo' ORDER BY id DESC LIMIT 1`,
    [tableId]
  );
  return rows;
}

// Lấy bill đang mở của bàn, hoặc tự tạo mới nếu chưa có — chỉ cho phép khi bàn đang co_khach
async function getOrCreateOpenBill(tableId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [tableRows] = await conn.query(
        `SELECT id, status, current_reservation_id FROM restaurant_tables WHERE id = ? FOR UPDATE`,
      [tableId]
    );
    if (tableRows.length === 0) {
      const err = new Error('Không tìm thấy bàn.');
      err.status = 404;
      throw err;
    }
    if (tableRows[0].status !== 'co_khach') {
      const err = new Error('Bàn hiện không có khách, không thể mở bill.');
      err.status = 409;
      throw err;
    }

    const [existingBill] = await conn.query(
      `SELECT id FROM bills WHERE table_id = ? AND status = 'mo' ORDER BY id DESC LIMIT 1`,
      [tableId]
    );
    if (existingBill.length > 0) {
      await conn.commit();
      return existingBill[0].id;
    }

    const [insertResult] = await conn.query(
      `INSERT INTO bills (table_id, reservation_id, status) VALUES (?, ?, 'mo')`,
      [tableId, tableRows[0].current_reservation_id || null]
    );

    await conn.commit();
    return insertResult.insertId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Lấy chi tiết bill + danh sách món (bỏ món đã xoá mềm)
async function findBillWithItems(billId) {
  const [billRows] = await pool.query(`SELECT * FROM bills WHERE id = ?`, [billId]);
  if (billRows.length === 0) return null;

  const [items] = await pool.query(
    `SELECT bi.id, bi.dish_id, d.name AS dish_name, bi.quantity, bi.unit_price,
            bi.status, bi.note, bi.created_at
     FROM bill_items bi
     JOIN dishes d ON d.id = bi.dish_id
     WHERE bi.bill_id = ? AND bi.deleted_at IS NULL
     ORDER BY bi.created_at ASC`,
    [billId]
  );

  return { bill: billRows[0], items };
}

// Thêm món — chốt giá tại thời điểm gọi món (unit_price không tham chiếu dishes.price về sau)
async function addItem(billId, dishId, quantity, note) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [billRows] = await conn.query(
      `SELECT status, payment_method FROM bills WHERE id = ? FOR UPDATE`,
      [billId]
    );
    if (billRows.length === 0) {
      const err = new Error('Không tìm thấy bill.');
      err.status = 404;
      throw err;
    }
    if (billRows[0].status !== 'mo' || billRows[0].payment_method) {
      const err = new Error('Bill đã chờ thanh toán hoặc đã chốt, không thể thêm món.');
      err.status = 409;
      throw err;
    }

    const [dishRows] = await conn.query(
      `SELECT price, is_available FROM dishes WHERE id = ?`,
      [dishId]
    );
    if (dishRows.length === 0) {
      const err = new Error('Không tìm thấy món ăn.');
      err.status = 404;
      throw err;
    }
    if (!dishRows[0].is_available) {
      const err = new Error('Món này hiện đã hết, không thể thêm vào bill.');
      err.status = 409;
      throw err;
    }

    const [result] = await conn.query(
      `INSERT INTO bill_items (bill_id, dish_id, quantity, unit_price, status, note)
       VALUES (?, ?, ?, ?, 'cho_xac_nhan', ?)`,
      [billId, dishId, quantity, dishRows[0].price, note || null]
    );
    await conn.commit();
    return result.insertId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Xoá món (soft delete) — chỉ cho xoá khi bếp CHƯA bắt đầu chế biến (còn cho_xac_nhan)
async function removeItem(billId, itemId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [billRows] = await conn.query(
      `SELECT status, payment_method FROM bills WHERE id = ? FOR UPDATE`,
      [billId]
    );
    if (billRows.length === 0 || billRows[0].status !== 'mo' || billRows[0].payment_method) {
      await conn.commit();
      return 0;
    }

    const [result] = await conn.query(
      `UPDATE bill_items SET deleted_at = NOW()
       WHERE id = ? AND bill_id = ? AND deleted_at IS NULL AND status = 'cho_xac_nhan'`,
      [itemId, billId]
    );
    await conn.commit();
    return result.affectedRows;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ===== Phase 6: Kitchen Display System =====

const KITCHEN_NEXT_STATUS = {
  cho_xac_nhan: 'dang_che_bien',
  dang_che_bien: 'san_sang',
};

// Hàng đợi bếp: mọi món đang cho_xac_nhan/dang_che_bien, TẤT CẢ các bàn, xếp theo thời gian thêm vào (FIFO)
async function findKitchenQueue() {
  const [rows] = await pool.query(
    `SELECT bi.id, bi.bill_id, bi.dish_id, d.name AS dish_name, bi.quantity,
            bi.status, bi.note, bi.created_at, t.table_number
     FROM bill_items bi
     JOIN dishes d ON d.id = bi.dish_id
     JOIN bills b ON b.id = bi.bill_id
     JOIN restaurant_tables t ON t.id = b.table_id
     WHERE bi.deleted_at IS NULL AND bi.status IN ('cho_xac_nhan', 'dang_che_bien')
     ORDER BY bi.created_at ASC`
  );
  return rows;
}

// Món đã nấu xong (san_sang), chờ phuc_vu mang ra bàn
async function findReadyItems() {
  const [rows] = await pool.query(
    `SELECT bi.id, bi.bill_id, bi.dish_id, d.name AS dish_name, bi.quantity,
            bi.status, bi.note, bi.created_at, t.table_number
     FROM bill_items bi
     JOIN dishes d ON d.id = bi.dish_id
     JOIN bills b ON b.id = bi.bill_id
     JOIN restaurant_tables t ON t.id = b.table_id
     WHERE bi.deleted_at IS NULL AND bi.status = 'san_sang'
     ORDER BY bi.created_at ASC`
  );
  return rows;
}

// Bếp bấm "chuyển bước tiếp theo" — tự tính bước kế tiếp dựa trên trạng thái hiện tại,
// dùng FOR UPDATE để tránh 2 người bếp cùng bấm 1 món trùng lúc (race condition).
async function advanceItemStatus(itemId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT status FROM bill_items WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
      [itemId]
    );
    if (rows.length === 0) {
      const err = new Error('Không tìm thấy món.');
      err.status = 404;
      throw err;
    }

    const nextStatus = KITCHEN_NEXT_STATUS[rows[0].status];
    if (!nextStatus) {
      const err = new Error('Món đã ở bước cuối hoặc không ở trạng thái bếp có thể xử lý.');
      err.status = 409;
      throw err;
    }

    await conn.query(`UPDATE bill_items SET status = ? WHERE id = ?`, [nextStatus, itemId]);
    await conn.commit();
    return nextStatus;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// phuc_vu đánh dấu đã mang món ra bàn: san_sang -> da_phuc_vu
async function markItemServed(itemId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT status FROM bill_items WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
      [itemId]
    );
    if (rows.length === 0) {
      const err = new Error('Không tìm thấy món.');
      err.status = 404;
      throw err;
    }
    if (rows[0].status !== 'san_sang') {
      const err = new Error('Món chưa sẵn sàng, chưa thể đánh dấu đã phục vụ.');
      err.status = 409;
      throw err;
    }

    await conn.query(`UPDATE bill_items SET status = 'da_phuc_vu' WHERE id = ?`, [itemId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Lấy 1 món theo id kèm tên món + số bàn — dùng để đẩy realtime xuống bếp/phục vụ
async function findQueueItemById(itemId) {
  const [rows] = await pool.query(
    `SELECT bi.id, bi.bill_id, bi.dish_id, d.name AS dish_name, bi.quantity,
            bi.status, bi.note, bi.created_at, t.table_number
     FROM bill_items bi
     JOIN dishes d ON d.id = bi.dish_id
     JOIN bills b ON b.id = bi.bill_id
     JOIN restaurant_tables t ON t.id = b.table_id
     WHERE bi.id = ?`,
    [itemId]
  );
  return rows[0] || null;
}

// ===== Phase 7: thanh toán bill cuối =====

// Tính tổng kết tiền của 1 bill từ các món chưa xoá. `db` là pool hoặc connection (cả 2 đều có .query),
// để dùng chung cho cả đọc thường lẫn trong transaction thanh toán.
// Chỉ trừ cọc khi cọc đang ở trạng thái da_coc (cọc đã trừ vào bill khác thì không trừ lần 2 — trường hợp ghép bàn).
async function computeSummary(db, billId) {
  const [billRows] = await db.query(
    `SELECT b.*, t.table_number
     FROM bills b JOIN restaurant_tables t ON t.id = b.table_id
     WHERE b.id = ?`,
    [billId]
  );
  if (billRows.length === 0) return null;
  const bill = billRows[0];

  const [items] = await db.query(
    `SELECT bi.id, bi.dish_id, d.name AS dish_name, bi.quantity, bi.unit_price, bi.status, bi.note
     FROM bill_items bi
     JOIN dishes d ON d.id = bi.dish_id
     WHERE bi.bill_id = ? AND bi.deleted_at IS NULL
     ORDER BY bi.created_at ASC`,
    [billId]
  );

  const subtotal = items.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0);
  const unservedCount = items.filter((item) => item.status !== 'da_phuc_vu').length;

  let depositId = null;
  let depositAmount = 0;
  if (bill.reservation_id) {
    const [depositRows] = await db.query(
      `SELECT id, amount FROM deposits WHERE reservation_id = ? AND status = 'da_coc'`,
      [bill.reservation_id]
    );
    if (depositRows.length > 0) {
      depositId = depositRows[0].id;
      depositAmount = Number(depositRows[0].amount);
    }
  }

  return {
    bill,
    items,
    summary: {
      subtotal,
      deposit_id: depositId,
      deposit_amount: depositAmount,
      amount_due: Math.max(0, subtotal - depositAmount),
      unserved_count: unservedCount,
    },
  };
}

async function getPaymentSummary(billId) {
  return computeSummary(pool, billId);
}

// Chọn phương thức thanh toán, khóa nội dung bill và chờ thu ngân xác nhận.
async function requestPayment(billId, paymentMethod) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [lockedRows] = await conn.query(`SELECT status FROM bills WHERE id = ? FOR UPDATE`, [billId]);
    if (lockedRows.length === 0) {
      const err = new Error('Không tìm thấy bill.');
      err.status = 404;
      throw err;
    }
    if (lockedRows[0].status !== 'mo') {
      const err = new Error('Bill này đã được thanh toán rồi.');
      err.status = 409;
      throw err;
    }

    const { bill, items, summary } = await computeSummary(conn, billId);
    if (items.length === 0) {
      const err = new Error('Bill chưa có món nào, không có gì để thanh toán.');
      err.status = 409;
      throw err;
    }
    if (summary.unserved_count > 0) {
      const err = new Error(`Còn ${summary.unserved_count} món chưa phục vụ xong, chưa thể thanh toán.`);
      err.status = 409;
      throw err;
    }
    if (paymentMethod === 'online' && summary.amount_due <= 0) {
      const err = new Error('Không còn số tiền cần chuyển khoản (cọc đã đủ trả bill).');
      err.status = 409;
      throw err;
    }

    const paymentCode = paymentMethod === 'online' ? `BILL${billId}` : null;
    await conn.query(
      `UPDATE bills SET payment_method = ?, payment_code = ? WHERE id = ? AND status = 'mo'`,
      [paymentMethod, paymentCode, billId]
    );
    await conn.commit();

    return {
      bill_id: Number(billId),
      table_id: bill.table_id,
      table_number: bill.table_number,
      payment_method: paymentMethod,
      payment_code: paymentCode,
      summary,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Danh sách bill đang mở có ít nhất 1 món — thu_ngan xem để biết bàn nào cần thanh toán.
async function listPayableBills() {
  const [rows] = await pool.query(
    `SELECT b.id AS bill_id, b.table_id, t.table_number, b.reservation_id, b.created_at,
            COUNT(bi.id) AS item_count,
            SUM(CASE WHEN bi.status <> 'da_phuc_vu' THEN 1 ELSE 0 END) AS unserved_count,
            SUM(bi.unit_price * bi.quantity) AS subtotal,
            b.payment_method, b.payment_code,
            COALESCE(d.amount, 0) AS deposit_amount
     FROM bills b
     JOIN restaurant_tables t ON t.id = b.table_id
     JOIN bill_items bi ON bi.bill_id = b.id AND bi.deleted_at IS NULL
     LEFT JOIN deposits d ON d.reservation_id = b.reservation_id AND d.status = 'da_coc'
     WHERE b.status = 'mo'
         GROUP BY b.id, b.table_id, b.reservation_id, b.created_at, t.table_number,
          b.payment_method, b.payment_code, d.amount
     ORDER BY b.created_at ASC`
  );
  return rows.map((row) => {
    const subtotal = Number(row.subtotal);
    const depositAmount = Number(row.deposit_amount);
    return {
      bill_id: row.bill_id,
      table_id: row.table_id,
      table_number: row.table_number,
      reservation_id: row.reservation_id,
      created_at: row.created_at,
      item_count: Number(row.item_count),
      unserved_count: Number(row.unserved_count),
      subtotal,
      deposit_amount: depositAmount,
      amount_due: Math.max(0, subtotal - depositAmount),
      payment_method: row.payment_method,
      payment_code: row.payment_code,
    };
  });
}

// thu_ngan xác nhận đã thu tiền: chốt bill, trừ cọc, trả bàn về trống, hoàn tất đặt bàn — CÙNG 1 transaction.
async function payBill(billId, paymentMethod, cashierId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [lockedRows] = await conn.query(`SELECT * FROM bills WHERE id = ? FOR UPDATE`, [billId]);
    if (lockedRows.length === 0) {
      const err = new Error('Không tìm thấy bill.');
      err.status = 404;
      throw err;
    }
    if (lockedRows[0].status !== 'mo') {
      const err = new Error('Bill này đã được thanh toán rồi.');
      err.status = 409;
      throw err;
    }
    if (lockedRows[0].payment_method && lockedRows[0].payment_method !== paymentMethod) {
      const err = new Error('Phương thức thanh toán không khớp với yêu cầu đang chờ.');
      err.status = 409;
      throw err;
    }

    const { bill, items, summary } = await computeSummary(conn, billId);
    if (items.length === 0) {
      const err = new Error('Bill chưa có món nào, không có gì để thanh toán.');
      err.status = 409;
      throw err;
    }
    if (summary.unserved_count > 0) {
      const err = new Error(`Còn ${summary.unserved_count} món chưa phục vụ xong, chưa thể thanh toán.`);
      err.status = 409;
      throw err;
    }

    if (summary.deposit_id) {
      const [depositResult] = await conn.query(
        `UPDATE deposits SET status = 'da_tru_bill' WHERE id = ? AND status = 'da_coc'`,
        [summary.deposit_id]
      );
      if (depositResult.affectedRows === 0) {
        const err = new Error('Cọc vừa được xử lý ở nơi khác, vui lòng thử lại.');
        err.status = 409;
        throw err;
      }
    }

    const paymentCode = paymentMethod === 'online' ? `BILL${billId}` : null;
        await conn.query(
      `UPDATE bills
       SET status = 'da_thanh_toan', total_amount = ?, deposit_id = ?, payment_method = ?, payment_code = ?,
           paid_at = NOW(), paid_by = ?
       WHERE id = ?`,
      [summary.subtotal, summary.deposit_id, paymentMethod, paymentCode, cashierId, billId]
    );  

    await conn.query(
      `UPDATE restaurant_tables
       SET status = 'trong', locked_by = NULL, locked_until = NULL, current_reservation_id = NULL
       WHERE id = ?`,
      [bill.table_id]
    );

    // Đặt bàn ghép nhiều bàn: chỉ hoàn tất đặt bàn khi KHÔNG còn bàn nào của đơn này đang có khách.
    if (bill.reservation_id) {
      const [remaining] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM restaurant_tables WHERE current_reservation_id = ?`,
        [bill.reservation_id]
      );
      if (remaining[0].cnt === 0) {
        await conn.query(
          `UPDATE reservations SET status = 'hoan_thanh' WHERE id = ? AND status = 'da_dat'`,
          [bill.reservation_id]
        );
      }
    }

    await conn.commit();
    return {
      bill_id: Number(billId),
      table_id: bill.table_id,
      total: summary.subtotal,
      deposit_amount: summary.deposit_amount,
      amount_due: summary.amount_due,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  findOpenBillByTableId,
  getOrCreateOpenBill,
  findBillWithItems,
  addItem,
  removeItem,
  findKitchenQueue,
  findReadyItems,
  advanceItemStatus,
  markItemServed,
  findQueueItemById,
  getPaymentSummary,
  requestPayment,
  listPayableBills,
  payBill,
};