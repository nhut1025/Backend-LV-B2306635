const assert = require('node:assert/strict');
const test = require('node:test');
const { pool } = require('../src/config/db');
const reservationModel = require('../src/models/reservation.model');
const socket = require('../src/utils/socket');

const emitted = [];
const originalEmitToRoom = socket.emitToRoom;
socket.emitToRoom = (...args) => emitted.push(args);
delete require.cache[require.resolve('../src/controllers/reservation.controller')];
const reservationController = require('../src/controllers/reservation.controller');
const originalConfirmDeposit = reservationModel.confirmDeposit;

function createConnection({ depositStatus = 'cho_thanh_toan', reservationStatus = 'giu_tam', expired = false } = {}) {
  const calls = [];
  let rolledBack = false;
  let committed = false;
  const connection = {
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() { rolledBack = true; },
    release() {},
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM deposits WHERE id = ? FOR UPDATE')) {
        return [[{
          id: 27,
          reservation_id: 15,
          amount: '100000',
          transaction_code: 'COC15',
          status: depositStatus,
        }], []];
      }
      if (sql.includes('FROM reservations WHERE id = ? FOR UPDATE')) {
        return [[{ id: 15, status: reservationStatus }], []];
      }
      if (sql.includes('FROM restaurant_tables WHERE current_reservation_id = ? FOR UPDATE')) {
        return [[{
          id: 3,
          status: 'giu_tam',
          locked_until: expired ? '2026-11-15 10:00:00' : '2026-11-16 10:00:00',
          is_expired: expired ? 1 : 0,
        }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  return {
    connection,
    calls,
    get rolledBack() { return rolledBack; },
    get committed() { return committed; },
  };
}

test('confirms a valid deposit under locks and permits a null confirmer', async () => {
  const originalGetConnection = pool.getConnection;
  const state = createConnection();
  pool.getConnection = async () => state.connection;

  try {
    const result = await reservationModel.confirmDepositPayment(27, null);

    assert.deepEqual(result, {
      deposit_id: 27,
      reservation_id: 15,
      transaction_code: 'COC15',
      amount: 100000,
    });
    assert.match(state.calls[0].sql, /FROM deposits[\s\S]*FOR UPDATE/);
    assert.match(state.calls[1].sql, /FROM reservations[\s\S]*FOR UPDATE/);
    assert.match(state.calls[2].sql, /FROM restaurant_tables[\s\S]*FOR UPDATE/);
    assert.match(state.calls[3].sql, /status = 'da_coc'.*confirmed_by = \?.*WHERE id = \?/s);
    assert.deepEqual(state.calls[3].params, [null, 27]);
    assert.equal(state.committed, true);
    assert.equal(state.rolledBack, false);
  } finally {
    pool.getConnection = originalGetConnection;
  }
});

test('rejects an expired deposit hold without changing payment state', async () => {
  const originalGetConnection = pool.getConnection;
  const state = createConnection({ expired: true });
  pool.getConnection = async () => state.connection;

  try {
    await assert.rejects(
      reservationModel.confirmDepositPayment(27, null),
      (error) => error.status === 409 && error.code === 'DEPOSIT_HOLD_EXPIRED'
    );
    assert.equal(state.calls.some(({ sql }) => sql.includes("SET status = 'da_coc'")), false);
    assert.equal(state.committed, false);
    assert.equal(state.rolledBack, true);
  } finally {
    pool.getConnection = originalGetConnection;
  }
});

test('looks up deposits using the stored transfer code', async () => {
  const originalQuery = pool.query;
  let query;
  pool.query = async (sql, params) => {
    query = { sql, params };
    return [[{
      deposit_id: 27,
      reservation_id: 15,
      transaction_code: 'COC15',
      deposit_status: 'cho_thanh_toan',
      reservation_status: 'giu_tam',
      held_table_count: 1,
      invalid_held_table_count: 0,
    }], []];
  };

  try {
    const deposit = await reservationModel.findDepositPaymentByTransactionCode('COC15');
    assert.equal(deposit.deposit_id, 27);
    assert.match(query.sql, /d\.transaction_code = \?/);
    assert.deepEqual(query.params, ['COC15']);
  } finally {
    pool.query = originalQuery;
  }
});

test('manual deposit confirmation emits the same cashier refresh event', async () => {
  const result = {
    deposit_id: 27,
    reservation_id: 15,
    transaction_code: 'COC15',
    amount: 100000,
  };
  reservationModel.confirmDeposit = async () => result;
  emitted.length = 0;
  let responseBody;

  try {
    await reservationController.confirmDeposit(
      { params: { id: '15' }, user: { id: 8 } },
      { json(body) { responseBody = body; } },
      (error) => { throw error; }
    );

    assert.deepEqual(responseBody, {
      message: 'Đã xác nhận nhận cọc. Bàn chuyển sang trạng thái đã đặt.',
    });
    assert.deepEqual(emitted, [['thu_ngan', 'cashier:deposit-confirmed', result]]);
  } finally {
    reservationModel.confirmDeposit = originalConfirmDeposit;
    socket.emitToRoom = originalEmitToRoom;
  }
});
