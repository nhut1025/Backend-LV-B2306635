const { pool } = require('../config/db');

function toBillRow(row) {
  const total = Number(row.total_amount);
  const deposit = Number(row.deposit_amount);
  const isPaid = row.status === 'da_thanh_toan' && row.payment_method !== null;
  return {
    bill_id: row.bill_id,
    table_id: row.table_id,
    table_number: row.table_number,
    status: row.status,
    created_at: row.created_at,
    paid_at: row.paid_at || row.created_at,
    item_count: Number(row.item_count),
    total_amount: total,
    deposit_amount: deposit,
    collected_amount: isPaid ? Math.max(0, total - deposit) : 0,
    payment_method: row.payment_method,
    payment_code: row.payment_code,
    cashier_id: row.cashier_id,
    cashier_name: row.cashier_name,
  };
}

// Danh sách tất cả bill theo bộ lọc. Doanh thu chỉ được tính từ bill thanh toán thực tế.
async function listBills({ from, to, tableId, cashierId, paymentMethod }) {
  const conditions = [];
  const params = [];

  if (from) {
    conditions.push('COALESCE(b.paid_at, b.created_at) >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('COALESCE(b.paid_at, b.created_at) < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(to);
  }
  if (tableId) {
    conditions.push('b.table_id = ?');
    params.push(tableId);
  }
  if (cashierId) {
    conditions.push('b.paid_by = ?');
    params.push(cashierId);
  }
  if (paymentMethod) {
    conditions.push('b.payment_method = ?');
    params.push(paymentMethod);
  }

  const [rows] = await pool.query(
    `SELECT b.id AS bill_id, b.table_id, t.table_number, b.status, b.created_at, b.paid_at,
            CASE WHEN b.status = 'da_thanh_toan' THEN b.total_amount
                 ELSE COALESCE((SELECT SUM(bi.unit_price * bi.quantity)
                                FROM bill_items bi
                                WHERE bi.bill_id = b.id AND bi.deleted_at IS NULL), 0)
            END AS total_amount,
            CASE WHEN d.status IN ('da_coc', 'da_tru_bill') THEN COALESCE(d.amount, 0) ELSE 0 END AS deposit_amount,
            b.payment_method, b.payment_code,
            b.paid_by AS cashier_id, u.full_name AS cashier_name,
            (SELECT COUNT(*) FROM bill_items bi WHERE bi.bill_id = b.id AND bi.deleted_at IS NULL) AS item_count
     FROM bills b
     JOIN restaurant_tables t ON t.id = b.table_id
     LEFT JOIN deposits d ON d.id = b.deposit_id
       OR (b.deposit_id IS NULL AND d.reservation_id = b.reservation_id AND d.status = 'da_coc')
     LEFT JOIN users u ON u.id = b.paid_by
     ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY COALESCE(b.paid_at, b.created_at) DESC`,
    params
  );

  return rows.map(toBillRow);
}

// Dòng tổng cho đúng tập bill đang lọc.
function summarize(bills) {
  return bills.reduce(
    (acc, bill) => {
      acc.bill_count += 1;
      if (bill.status === 'da_thanh_toan' && bill.payment_method) {
        acc.paid_bill_count += 1;
        acc.total_amount += bill.total_amount;
        acc.deposit_amount += bill.deposit_amount;
        acc.collected_amount += bill.collected_amount;
        if (bill.payment_method === 'tien_mat') acc.cash_amount += bill.collected_amount;
        if (bill.payment_method === 'online') acc.online_amount += bill.collected_amount;
      }
      return acc;
    },
    { bill_count: 0, paid_bill_count: 0, total_amount: 0, deposit_amount: 0, collected_amount: 0, cash_amount: 0, online_amount: 0 }
  );
}

// Chi tiết một bill bất kỳ: thông tin tiền + người xác nhận + các món.
async function findBillDetail(billId) {
  const [billRows] = await pool.query(
    `SELECT b.id AS bill_id, b.table_id, t.table_number, b.reservation_id, b.created_at, b.paid_at,
            b.status, b.total_amount,
            CASE WHEN d.status IN ('da_coc', 'da_tru_bill') THEN COALESCE(d.amount, 0) ELSE 0 END AS deposit_amount,
            b.payment_method, b.payment_code,
            b.paid_by AS cashier_id, u.full_name AS cashier_name,
            d.confirmed_by AS deposit_confirmed_by_id, du.full_name AS deposit_confirmed_by_name
     FROM bills b
     JOIN restaurant_tables t ON t.id = b.table_id
     LEFT JOIN users u ON u.id = b.paid_by
     LEFT JOIN deposits d ON d.id = b.deposit_id
       OR (b.deposit_id IS NULL AND d.reservation_id = b.reservation_id AND d.status = 'da_coc')
     LEFT JOIN users du ON du.id = d.confirmed_by
     WHERE b.id = ?`,
    [billId]
  );
  if (billRows.length === 0) return null;
  const row = billRows[0];

  const [itemRows] = await pool.query(
    `SELECT bi.id, bi.dish_id, dsh.name AS dish_name, bi.quantity, bi.unit_price, bi.note, bi.status
     FROM bill_items bi
     JOIN dishes dsh ON dsh.id = bi.dish_id
     WHERE bi.bill_id = ? AND bi.deleted_at IS NULL
     ORDER BY bi.created_at ASC`,
    [billId]
  );

  const items = itemRows.map((item) => ({
    id: item.id,
    dish_id: item.dish_id,
    dish_name: item.dish_name,
    quantity: item.quantity,
    unit_price: Number(item.unit_price),
    line_total: Number(item.unit_price) * item.quantity,
    note: item.note,
    status: item.status,
  }));

  const itemTotal = items.reduce((sum, item) => sum + item.line_total, 0);
  const total = row.status === 'da_thanh_toan' ? Number(row.total_amount) : itemTotal;
  const deposit = Number(row.deposit_amount);
  return {
    bill: {
      bill_id: row.bill_id,
      table_id: row.table_id,
      table_number: row.table_number,
      reservation_id: row.reservation_id,
      status: row.status,
      created_at: row.created_at,
      paid_at: row.paid_at || row.created_at,
      total_amount: total,
      deposit_amount: deposit,
      collected_amount: row.status === 'da_thanh_toan' && row.payment_method
        ? Math.max(0, total - deposit)
        : 0,
      payment_method: row.payment_method,
      payment_code: row.payment_code,
      cashier_id: row.cashier_id,
      cashier_name: row.cashier_name,
      deposit_confirmed_by_id: row.deposit_confirmed_by_id,
      deposit_confirmed_by_name: row.deposit_confirmed_by_name,
    },
    items,
  };
}

module.exports = { listBills, summarize, findBillDetail };