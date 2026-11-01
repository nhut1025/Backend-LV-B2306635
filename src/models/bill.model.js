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
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();

    const [initialTableRows] = await conn.query(
      `SELECT id, status, current_reservation_id
       FROM restaurant_tables WHERE id = ?`,
      [tableId]
    );
    if (initialTableRows.length === 0) {
      const err = new Error('Không tìm thấy bàn.');
      err.status = 404;
      throw err;
    }

    const reservationId = initialTableRows[0].current_reservation_id;
    let tableRows;
    let representativeTableId = Number(tableId);
    if (reservationId) {
      const [reservationRows] = await conn.query(
        `SELECT id, status FROM reservations WHERE id = ? FOR UPDATE`,
        [reservationId]
      );
      if (reservationRows.length === 0 || reservationRows[0].status !== 'da_dat') {
        const err = new Error('Đặt bàn không còn ở trạng thái đang phục vụ.');
        err.status = 409;
        throw err;
      }

      const [groupTables] = await conn.query(
        `SELECT id FROM restaurant_tables
         WHERE current_reservation_id = ? AND status = 'co_khach'
         ORDER BY id`,
        [reservationId]
      );
      const lockedGroupTables = [];
      for (const table of groupTables) {
        const [rows] = await conn.query(
          `SELECT id, status, current_reservation_id
           FROM restaurant_tables WHERE id = ? FOR UPDATE`,
          [table.id]
        );
        if (rows[0]) lockedGroupTables.push(rows[0]);
      }
      tableRows = lockedGroupTables.filter((table) => Number(table.id) === Number(tableId));
      if (tableRows.length === 0 || tableRows[0].status !== 'co_khach'
        || Number(tableRows[0].current_reservation_id) !== Number(reservationId)) {
        const err = new Error('Bàn hiện không có khách của đặt chỗ này.');
        err.status = 409;
        throw err;
      }
      if (lockedGroupTables.length === 0) {
        const err = new Error('Không tìm thấy bàn đang phục vụ cho đặt chỗ này.');
        err.status = 409;
        throw err;
      }
      representativeTableId = Math.min(...lockedGroupTables.map((table) => Number(table.id)));
    } else {
      const [lockedTableRows] = await conn.query(
        `SELECT id, status, current_reservation_id
         FROM restaurant_tables WHERE id = ? FOR UPDATE`,
        [tableId]
      );
      tableRows = lockedTableRows;
    }

    if (tableRows.length === 0 || tableRows[0].status !== 'co_khach') {
      const err = new Error('Bàn hiện không có khách, không thể mở bill.');
      err.status = 409;
      throw err;
    }

    // The request may have waited on the reservation lock; read the latest bill state.
    const [existingBill] = reservationId
      ? await conn.query(
        `SELECT id, status, payment_method FROM bills
         WHERE reservation_id = ? AND status = 'mo' ORDER BY id`,
        [reservationId]
      )
      : await conn.query(
        `SELECT id, status, payment_method FROM bills
         WHERE table_id = ? AND status = 'mo' ORDER BY id DESC LIMIT 1`,
        [tableId]
      );
    if (existingBill.length > 1) {
      const err = new Error('Đặt bàn đang có nhiều bill mở. Vui lòng xử lý bill trước khi gọi thêm món.');
      err.status = 409;
      throw err;
    }
    if (existingBill.length > 0) {
      await conn.commit();
      return existingBill[0].id;
    }

    const [insertResult] = await conn.query(
      `INSERT INTO bills (table_id, reservation_id, status) VALUES (?, ?, 'mo')`,
      [representativeTableId, reservationId || null]
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
  const [billRows] = await pool.query(
    `SELECT b.*, t.table_number FROM bills b
     JOIN restaurant_tables t ON t.id = b.table_id
     WHERE b.id = ?`,
    [billId]
  );
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

async function findMyPaidBillHistory(userId) {
  const [bills] = await pool.query(
    `SELECT b.id, b.table_id, t.table_number, b.reservation_id, b.total_amount,
            b.deposit_id, COALESCE(d.amount, 0) AS deposit_amount,
            b.payment_method, b.payment_code, b.created_at, b.paid_at,
            b.paid_by AS cashier_id, cashier.full_name AS cashier_name,
            d.confirmed_by AS deposit_confirmed_by_id,
            deposit_cashier.full_name AS deposit_confirmed_by_name,
            br.id AS review_id, br.rating AS review_rating,
            br.food_rating AS review_food_rating,
            br.service_rating AS review_service_rating,
            br.ambience_rating AS review_ambience_rating,
            br.comment AS review_comment,
            br.created_at AS review_created_at, br.updated_at AS review_updated_at
     FROM bills b
     JOIN reservations r ON r.id = b.reservation_id
     JOIN restaurant_tables t ON t.id = b.table_id
     LEFT JOIN deposits d ON d.id = b.deposit_id
     LEFT JOIN users cashier ON cashier.id = b.paid_by
     LEFT JOIN users deposit_cashier ON deposit_cashier.id = d.confirmed_by
     LEFT JOIN bill_reviews br ON br.bill_id = b.id AND br.user_id = r.user_id
     WHERE r.user_id = ? AND b.status = 'da_thanh_toan'
       AND b.payment_method IS NOT NULL
     ORDER BY b.paid_at DESC, b.id DESC`,
    [userId]
  );
  if (bills.length === 0) return [];

  const billIds = bills.map((bill) => bill.id);
  const [items] = await pool.query(
    `SELECT bi.id, bi.bill_id, bi.dish_id, d.name AS dish_name,
            bi.quantity, bi.unit_price, bi.note, bi.status, bri.sentiment AS review_sentiment
     FROM bill_items bi
     JOIN dishes d ON d.id = bi.dish_id
     LEFT JOIN bill_reviews br ON br.bill_id = bi.bill_id
     LEFT JOIN bill_review_items bri ON bri.bill_review_id = br.id AND bri.bill_item_id = bi.id
     WHERE bi.bill_id IN (?) AND bi.deleted_at IS NULL
     ORDER BY bi.created_at ASC, bi.id ASC`,
    [billIds]
  );
  const itemsByBill = new Map(billIds.map((id) => [id, []]));
  for (const item of items) {
    itemsByBill.get(item.bill_id).push(item);
  }

  return bills.map((bill) => {
    const depositAmount = Number(bill.deposit_amount);
    const totalAmount = Number(bill.total_amount);
    return {
      ...bill,
      total_amount: totalAmount,
      deposit_amount: depositAmount,
      amount_paid: Math.max(0, totalAmount - depositAmount),
      review: bill.review_id ? {
        id: bill.review_id,
        rating: Number(bill.review_rating),
        food_rating: bill.review_food_rating === null ? null : Number(bill.review_food_rating),
        service_rating: bill.review_service_rating === null ? null : Number(bill.review_service_rating),
        ambience_rating: bill.review_ambience_rating === null ? null : Number(bill.review_ambience_rating),
        comment: bill.review_comment,
        created_at: bill.review_created_at,
        updated_at: bill.review_updated_at,
      } : null,
      items: itemsByBill.get(bill.id).map((item) => ({
        ...item,
        unit_price: Number(item.unit_price),
        line_total: Number(item.unit_price) * item.quantity,
      })),
    };
  });
}

async function savePaidBillReview(
  billId,
  userId,
  { rating, foodRating, serviceRating, ambienceRating, comment, itemFeedback },
  isEdit
) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [billRows] = await conn.query(
      `SELECT b.id, b.status, r.user_id
       FROM bills b
       JOIN reservations r ON r.id = b.reservation_id
       WHERE b.id = ?
       FOR UPDATE`,
      [billId]
    );
    if (billRows.length === 0 || Number(billRows[0].user_id) !== Number(userId)) {
      const err = new Error('Không tìm thấy bill đã thanh toán của bạn.');
      err.status = 404;
      throw err;
    }
    if (billRows[0].status !== 'da_thanh_toan') {
      const err = new Error('Chỉ có thể đánh giá bill đã thanh toán.');
      err.status = 409;
      throw err;
    }

    const [itemRows] = await conn.query(
      `SELECT id FROM bill_items
       WHERE bill_id = ? AND deleted_at IS NULL
       ORDER BY id ASC
       FOR UPDATE`,
      [billId]
    );
    const billItemIds = itemRows.map((item) => Number(item.id));
    const feedbackIds = itemFeedback.map((item) => item.bill_item_id).sort((a, b) => a - b);
    if (billItemIds.length !== feedbackIds.length
      || billItemIds.some((id, index) => id !== feedbackIds[index])) {
      const err = new Error('Vui lòng chọn thích hoặc không thích cho từng món trong bill.');
      err.status = 400;
      throw err;
    }

    const [reviewRows] = await conn.query(
      `SELECT id FROM bill_reviews WHERE bill_id = ? FOR UPDATE`,
      [billId]
    );
    let reviewId;
    if (isEdit) {
      if (reviewRows.length === 0) {
        const err = new Error('Bill này chưa có đánh giá để chỉnh sửa.');
        err.status = 404;
        throw err;
      }
      reviewId = reviewRows[0].id;
      await conn.query(
        `UPDATE bill_reviews
         SET rating = ?, food_rating = ?, service_rating = ?, ambience_rating = ?, comment = ?
         WHERE id = ?`,
        [rating, foodRating, serviceRating, ambienceRating, comment, reviewId]
      );
    } else {
      if (reviewRows.length > 0) {
        const err = new Error('Bill này đã được đánh giá. Bạn có thể chỉnh sửa đánh giá hiện có.');
        err.status = 409;
        throw err;
      }
      const [result] = await conn.query(
        `INSERT INTO bill_reviews
          (bill_id, user_id, rating, food_rating, service_rating, ambience_rating, comment)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [billId, userId, rating, foodRating, serviceRating, ambienceRating, comment]
      );
      reviewId = result.insertId;
    }

    for (const item of itemFeedback) {
      const [existingFeedback] = await conn.query(
        `SELECT id FROM bill_review_items
         WHERE bill_review_id = ? AND bill_item_id = ?`,
        [reviewId, item.bill_item_id]
      );
      if (existingFeedback.length > 0) {
        await conn.query(
          `UPDATE bill_review_items SET sentiment = ? WHERE id = ?`,
          [item.sentiment, existingFeedback[0].id]
        );
      } else {
        await conn.query(
          `INSERT INTO bill_review_items (bill_review_id, bill_item_id, sentiment)
           VALUES (?, ?, ?)`,
          [reviewId, item.bill_item_id, item.sentiment]
        );
      }
    }

    const [savedRows] = await conn.query(
      `SELECT id, rating, food_rating, service_rating, ambience_rating, comment, created_at, updated_at
       FROM bill_reviews WHERE id = ?`,
      [reviewId]
    );
    await conn.commit();
    return {
      ...savedRows[0],
      rating: Number(savedRows[0].rating),
      food_rating: Number(savedRows[0].food_rating),
      service_rating: Number(savedRows[0].service_rating),
      ambience_rating: Number(savedRows[0].ambience_rating),
      item_feedback: itemFeedback,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function findRestaurantReviews({ rating, limit, offset }) {
  const [summaryRows] = await pool.query(
    `SELECT COUNT(*) AS review_count,
            COALESCE(AVG(br.rating), 0) AS average_rating,
            COALESCE(AVG(br.food_rating), 0) AS food_rating,
            COALESCE(AVG(br.service_rating), 0) AS service_rating,
            COALESCE(AVG(br.ambience_rating), 0) AS ambience_rating,
            COUNT(br.food_rating) AS food_rating_count,
            COUNT(br.service_rating) AS service_rating_count,
            COUNT(br.ambience_rating) AS ambience_rating_count
     FROM bill_reviews br
     JOIN bills b ON b.id = br.bill_id AND b.status = 'da_thanh_toan'
     JOIN reservations r ON r.id = b.reservation_id AND r.user_id = br.user_id
    `
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS filtered_count
     FROM bill_reviews br
     JOIN bills b ON b.id = br.bill_id AND b.status = 'da_thanh_toan'
     JOIN reservations r ON r.id = b.reservation_id AND r.user_id = br.user_id
     WHERE (? IS NULL OR br.rating = ? OR (? = 2 AND br.rating <= 2))`,
    [rating, rating, rating]
  );
  const [rows] = await pool.query(
    `    SELECT br.id, br.rating, br.food_rating, br.service_rating, br.ambience_rating,
           br.comment, br.created_at, br.updated_at, b.paid_at,
           br.manager_reply, br.replied_at, manager.full_name AS manager_name
    FROM bill_reviews br
    JOIN bills b ON b.id = br.bill_id AND b.status = 'da_thanh_toan'
    JOIN reservations r ON r.id = b.reservation_id AND r.user_id = br.user_id
    LEFT JOIN users manager ON manager.id = br.replied_by
     WHERE (? IS NULL OR br.rating = ? OR (? = 2 AND br.rating <= 2))
     ORDER BY br.created_at DESC, br.id DESC
     LIMIT ? OFFSET ?`,
    [rating, rating, rating, limit, offset]
  );
  return {
    summary: {
      review_count: Number(summaryRows[0].review_count),
      average_rating: Number(summaryRows[0].average_rating),
      food_rating: Number(summaryRows[0].food_rating),
      service_rating: Number(summaryRows[0].service_rating),
      ambience_rating: Number(summaryRows[0].ambience_rating),
      food_rating_count: Number(summaryRows[0].food_rating_count),
      service_rating_count: Number(summaryRows[0].service_rating_count),
      ambience_rating_count: Number(summaryRows[0].ambience_rating_count),
    },
    filtered_count: Number(countRows[0].filtered_count),
    reviews: rows.map((row) => ({
      ...row,
      rating: Number(row.rating),
      food_rating: row.food_rating === null ? null : Number(row.food_rating),
      service_rating: row.service_rating === null ? null : Number(row.service_rating),
      ambience_rating: row.ambience_rating === null ? null : Number(row.ambience_rating),
    })),
  };
}

async function saveManagerReviewReply(reviewId, managerId, reply) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [reviewRows] = await conn.query(
      `SELECT br.id
       FROM bill_reviews br
       JOIN bills b ON b.id = br.bill_id AND b.status = 'da_thanh_toan'
       JOIN reservations r ON r.id = b.reservation_id AND r.user_id = br.user_id
       WHERE br.id = ?
       FOR UPDATE`,
      [reviewId]
    );
    if (reviewRows.length === 0) {
      const err = new Error('Không tìm thấy đánh giá của bill đã thanh toán.');
      err.status = 404;
      throw err;
    }

    await conn.query(
      `UPDATE bill_reviews
       SET manager_reply = ?, replied_by = ?, replied_at = NOW()
       WHERE id = ?`,
      [reply, managerId, reviewId]
    );
    const [savedRows] = await conn.query(
      `SELECT br.id, br.manager_reply, br.replied_at, u.full_name AS manager_name
       FROM bill_reviews br
       LEFT JOIN users u ON u.id = br.replied_by
       WHERE br.id = ?`,
      [reviewId]
    );
    await conn.commit();
    return savedRows[0];
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
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

    let remainingOpenBills = 0;
    if (bill.reservation_id) {
      const [openBillRows] = await conn.query(
        `SELECT COUNT(*) AS bill_count
         FROM bills WHERE reservation_id = ? AND status = 'mo'`,
        [bill.reservation_id]
      );
      remainingOpenBills = Number(openBillRows[0].bill_count);
    }

    if (bill.reservation_id && remainingOpenBills === 0) {
      await conn.query(
        `UPDATE restaurant_tables
         SET status = 'trong', locked_by = NULL, locked_until = NULL, current_reservation_id = NULL
         WHERE current_reservation_id = ? AND status = 'co_khach'`,
        [bill.reservation_id]
      );
    } else {
      await conn.query(
        `UPDATE restaurant_tables
         SET status = 'trong', locked_by = NULL, locked_until = NULL, current_reservation_id = NULL
         WHERE id = ? AND status = 'co_khach'`,
        [bill.table_id]
      );
    }

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
  findMyPaidBillHistory,
  savePaidBillReview,
  findRestaurantReviews,
  saveManagerReviewReply,
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