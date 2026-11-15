const assert = require('node:assert/strict');
const test = require('node:test');
const { pool } = require('../src/config/db');
const billController = require('../src/controllers/bill.controller');
const billModel = require('../src/models/bill.model');

test('kitchen history returns attributed completed items filtered by table', async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT COUNT(*) AS total')) {
      return [[{ total: '1' }], []];
    }
    return [[{
      id: 8,
      dish_name: 'Món thử',
      table_number: 'B2',
      status: 'da_phuc_vu',
      accepted_by_name: 'Nhân viên bếp',
      ready_at: '2026-11-14 10:00:00',
    }], []];
  };

  try {
    const result = await billModel.findKitchenHistory({
      tableNumber: 'B2',
      limit: 50,
      offset: 0,
    });

    assert.equal(result.total, 1);
    assert.equal(result.items[0].table_number, 'B2');
    assert.match(calls[0].sql, /bi\.status IN \('san_sang', 'da_phuc_vu'\)/);
    assert.match(calls[0].sql, /bi\.accepted_by_name IS NOT NULL/);
    assert.deepEqual(calls[0].params, ['B2']);
    assert.deepEqual(calls[1].params, ['B2', 50, 0]);
  } finally {
    pool.query = originalQuery;
  }
});

test('records ready_at when the kitchen completes an item', async () => {
  const originalGetConnection = pool.getConnection;
  let readyUpdate;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params = []) {
      if (sql.includes('SELECT status, accepted_by, accepted_by_name')) {
        return [[{
          status: 'dang_che_bien',
          accepted_by: 7,
          accepted_by_name: 'Nhân viên bếp',
        }], []];
      }
      if (sql.includes('UPDATE bill_items')) {
        readyUpdate = { sql, params };
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  pool.getConnection = async () => connection;

  try {
    const status = await billModel.advanceItemStatus(8, 7, 'dang_che_bien');

    assert.equal(status, 'san_sang');
    assert.match(readyUpdate.sql, /ready_at = NOW\(\)/);
    assert.deepEqual(readyUpdate.params, ['san_sang', 8]);
  } finally {
    pool.getConnection = originalGetConnection;
  }
});

test('kitchen history endpoint validates filters and paginates results', async () => {
  const originalFindKitchenHistory = billModel.findKitchenHistory;
  let received;
  billModel.findKitchenHistory = async (options) => {
    received = options;
    return { items: [{ id: 8, table_number: 'B2' }], total: 51 };
  };
  try {
    let responseBody;
    const response = {
      json(body) {
        responseBody = body;
      },
    };
    await billController.kitchenHistory(
      { query: { table_number: ' B2 ', page: '2' } },
      response,
      (error) => { throw error; }
    );

    assert.deepEqual(received, { tableNumber: 'B2', limit: 50, offset: 50 });
    assert.deepEqual(responseBody, {
      history: [{ id: 8, table_number: 'B2' }],
      page: 2,
      per_page: 50,
      total_items: 51,
      total_pages: 2,
    });
  } finally {
    billModel.findKitchenHistory = originalFindKitchenHistory;
  }
});
