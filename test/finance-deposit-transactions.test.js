const assert = require('node:assert/strict');
const test = require('node:test');
const { pool } = require('../src/config/db');
const financeController = require('../src/controllers/finance.controller');
const financeModel = require('../src/models/finance.model');

test('deposit ledger includes receipts, refunds, and forfeitures without double counting', async () => {
  const originalQuery = pool.query;
  let call;
  pool.query = async (sql, params) => {
    call = { sql, params };
    return [[
      { transaction_type: 'received', reservation_id: 15, amount: '100000', transaction_at: '2026-11-15 10:00:00', handled_by_name: 'SePay tự động' },
      { transaction_type: 'refund', reservation_id: 16, amount: '20000', transaction_at: '2026-11-15 11:00:00', handled_by_name: 'Quản lý' },
      { transaction_type: 'forfeited', reservation_id: 17, amount: '50000', transaction_at: '2026-11-15 12:00:00', handled_by_name: null },
    ], []];
  };

  try {
    const result = await financeModel.listDepositTransactions({
      from: '2026-11-01',
      to: '2026-11-30',
      tableId: 3,
      cashierId: 8,
      paymentMethod: 'online',
    });

    assert.match(call.sql, /WHERE d\.paid_at IS NOT NULL/);
    assert.match(call.sql, /WHERE d\.status = 'da_hoan'/);
    assert.match(call.sql, /WHERE d\.status = 'mat_coc'/);
    assert.match(call.sql, /reservation_tables rt/);
    assert.match(call.sql, /handled_by_id = \?/);
    assert.deepEqual(call.params, ['2026-11-01', '2026-11-30', 3, 8]);
    assert.equal(result.totals.received_amount, 100000);
    assert.equal(result.totals.refunded_amount, 20000);
    assert.equal(result.totals.forfeited_amount, 50000);
    assert.equal(
      result.totals.received_amount - result.totals.refunded_amount,
      80000,
      'forfeited deposits are a classification, not a second cash receipt'
    );
  } finally {
    pool.query = originalQuery;
  }
});

test('cash payment filter excludes bank-transfer deposit transactions', async () => {
  const originalQuery = pool.query;
  let call;
  pool.query = async (sql, params) => {
    call = { sql, params };
    return [[], []];
  };

  try {
    await financeModel.listDepositTransactions({ paymentMethod: 'tien_mat' });
    assert.match(call.sql, /1 = 0/);
    assert.deepEqual(call.params, []);
  } finally {
    pool.query = originalQuery;
  }
});

test('finance controller forwards the manager report filters to the deposit ledger', async () => {
  const originalList = financeModel.listDepositTransactions;
  let received;
  financeModel.listDepositTransactions = async (filters) => {
    received = filters;
    return { transactions: [], totals: { received_amount: 0, refunded_amount: 0, forfeited_amount: 0 } };
  };
  try {
    let responseBody;
    await financeController.listDepositTransactions(
      { query: { from: '2026-11-01', to: '2026-11-30', table_id: '3', cashier_id: '8', payment_method: 'online' } },
      { json(body) { responseBody = body; } },
      (error) => { throw error; }
    );

    assert.deepEqual(received, {
      from: '2026-11-01',
      to: '2026-11-30',
      tableId: 3,
      cashierId: 8,
      paymentMethod: 'online',
    });
    assert.deepEqual(responseBody.totals, {
      received_amount: 0,
      refunded_amount: 0,
      forfeited_amount: 0,
    });
  } finally {
    financeModel.listDepositTransactions = originalList;
  }
});
