const assert = require('node:assert/strict');
const test = require('node:test');
const tableModel = require('../src/models/table.model');
const { pool } = require('../src/config/db');
const tableController = require('../src/controllers/table.controller');

test('remove deactivates an empty table and reports success', async () => {
  const originalFindStatusById = tableModel.findStatusById;
  const originalDeactivate = tableModel.deactivate;
  let removeCalls = 0;
  let nextError;

  tableModel.findStatusById = async () => [{ status: 'trong' }];
  tableModel.deactivate = async () => {
    removeCalls += 1;
    return [{ affectedRows: 1 }];
  };

  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  try {
    await tableController.remove({ params: { id: '1' } }, res, (err) => {
      nextError = err;
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, 'Đã ngừng sử dụng bàn.');
    assert.equal(removeCalls, 1);
    assert.equal(nextError, undefined);
  } finally {
    tableModel.findStatusById = originalFindStatusById;
    tableModel.deactivate = originalDeactivate;
  }
});

test('deactivate keeps the table row and only marks an empty active table inactive', async () => {
  const originalQuery = pool.query;
  let query;
  pool.query = async (...args) => {
    query = args;
    return [{ affectedRows: 1 }, []];
  };

  try {
    await tableModel.deactivate(7);
    assert.match(query[0], /^UPDATE restaurant_tables/i);
    assert.match(query[0], /SET is_active = 0/);
    assert.match(query[0], /status = 'trong' AND is_active = 1/);
    assert.deepEqual(query[1], [7]);
  } finally {
    pool.query = originalQuery;
  }
});
