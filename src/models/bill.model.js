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
  const [dishRows] = await pool.query(
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

  const [result] = await pool.query(
    `INSERT INTO bill_items (bill_id, dish_id, quantity, unit_price, status, note)
     VALUES (?, ?, ?, ?, 'cho_xac_nhan', ?)`,
    [billId, dishId, quantity, dishRows[0].price, note || null]
  );
  return result.insertId;
}

// Xoá món (soft delete) — chỉ cho xoá khi bếp CHƯA bắt đầu chế biến (còn cho_xac_nhan)
async function removeItem(billId, itemId) {
  const [result] = await pool.query(
    `UPDATE bill_items SET deleted_at = NOW()
     WHERE id = ? AND bill_id = ? AND deleted_at IS NULL AND status = 'cho_xac_nhan'`,
    [itemId, billId]
  );
  return result.affectedRows;
}

module.exports = {
  findOpenBillByTableId,
  getOrCreateOpenBill,
  findBillWithItems,
  addItem,
  removeItem,
};