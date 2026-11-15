const assert = require('node:assert/strict');
const test = require('node:test');
const { pool } = require('../src/config/db');
const financeController = require('../src/controllers/finance.controller');
const financeModel = require('../src/models/finance.model');

test('cashier payment history returns paid bills with bounded pagination and filters', async () => {
  const originalQuery = pool.query;
  let call;
  pool.query = async (sql, params) => {
    call = { sql, params };
    return [Array.from({ length: 31 }, (_, index) => ({
      bill_id: index + 1,
      table_id: 3,
      table_number: 'B3',
      status: 'da_thanh_toan',
      created_at: '2026-11-15 10:00:00',
      paid_at: '2026-11-15 10:30:00',
      total_amount: '150000',
      deposit_amount: '50000',
      payment_method: 'online',
      payment_code: 'BILL1',
      cashier_id: null,
      cashier_name: null,
      item_count: '2',
    })), []];
  };

  try {
    const result = await financeModel.listCashierPaymentHistory({
      from: '2026-11-01',
      to: '2026-11-15',
      search: 'BILL',
      paymentMethod: 'online',
      limit: 30,
      offset: 30,
    });

    assert.equal(result.bills.length, 30);
    assert.equal(result.has_more, true);
    assert.equal(result.bills[0].collected_amount, 100000);
    assert.match(call.sql, /b\.status = 'da_thanh_toan'/);
    assert.match(call.sql, /b\.payment_method IS NOT NULL/);
    assert.match(call.sql, /b\.payment_code/);
    assert.deepEqual(call.params, [
      '2026-11-01',
      '2026-11-15',
      'online',
      '%BILL%',
      '%BILL%',
      '%BILL%',
      31,
      30,
    ]);
  } finally {
    pool.query = originalQuery;
  }
});

test('cashier payment history detail excludes bills that are not paid', async () => {
  const originalQuery = pool.query;
  let queryCount = 0;
  pool.query = async (sql) => {
    queryCount += 1;
    if (sql.includes("b.status = 'da_thanh_toan'")) return [[], []];
    return [[{
      bill_id: 12,
      table_id: 3,
      table_number: 'B3',
      status: 'mo',
      total_amount: 150000,
      deposit_amount: 0,
      payment_method: 'online',
    }], []];
  };

  try {
    const result = await financeModel.findCashierPaymentHistoryDetail(12);
    assert.equal(result, null);
    assert.equal(queryCount, 1);
  } finally {
    pool.query = originalQuery;
  }
});

test('cashier payment history validates filters and paginates results', async () => {
  const originalListHistory = financeModel.listCashierPaymentHistory;
  let received;
  financeModel.listCashierPaymentHistory = async (options) => {
    received = options;
    return { bills: [{ bill_id: 12 }], has_more: false };
  };
  try {
    let responseBody;
    const response = {
      json(body) {
        responseBody = body;
      },
    };
    await financeController.listCashierPaymentHistory(
      { query: { from: '2026-11-01', to: '2026-11-15', search: ' B3 ', payment_method: 'online', page: '2' } },
      response,
      (error) => { throw error; }
    );

    assert.deepEqual(received, {
      from: '2026-11-01',
      to: '2026-11-15',
      search: 'B3',
      paymentMethod: 'online',
      limit: 30,
      offset: 30,
    });
    assert.deepEqual(responseBody, {
      bills: [{ bill_id: 12 }],
      has_more: false,
      page: 2,
      per_page: 30,
    });
  } finally {
    financeModel.listCashierPaymentHistory = originalListHistory;
  }
});

test('cashier payment history rejects invalid date ranges', async () => {
  const responseBody = {};
  const response = {
    status(status) {
      responseBody.status = status;
      return this;
    },
    json(body) {
      responseBody.body = body;
    },
  };

  await financeController.listCashierPaymentHistory(
    { query: { from: '2026-11-16', to: '2026-11-15' } },
    response,
    (error) => { throw error; }
  );

  assert.equal(responseBody.status, 400);
  assert.match(responseBody.body.message, /Ngày bắt đầu/);
});
