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

function createRefundCancellationConnection(accountRows) {
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
      if (sql.includes('FROM deposits WHERE reservation_id = ? FOR UPDATE')) {
        return [[{ id: 44, status: 'da_coc', amount: '50000' }], []];
      }
      if (sql.includes('FROM reservations WHERE id = ? FOR UPDATE')) {
        return [[{
          id: 15,
          user_id: 10,
          status: 'da_dat',
          refund_eligible: 1,
          late_cancel_eligible: 0,
        }], []];
      }
      if (sql.includes('FROM user_refund_bank_accounts')) return [accountRows, []];
      if (sql.includes('SELECT cancelled_at FROM reservations')) {
        return [[{ cancelled_at: '2026-11-17 10:00:00' }], []];
      }
      if (sql.includes('FROM restaurant_tables WHERE current_reservation_id = ? FOR UPDATE')
        || sql.includes('FROM reservation_preorders WHERE reservation_id = ? FOR UPDATE')) {
        return [[], []];
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

test('refund cancellation snapshots only the selected account owned by the customer', async () => {
  const originalGetConnection = pool.getConnection;
  const originalQuery = pool.query;
  const state = createRefundCancellationConnection([{
    bank_code: 'VCB',
    account_number: '123456789',
    account_name: 'NGUYEN VAN A',
  }]);
  pool.getConnection = async () => state.connection;
  pool.query = async () => [[], []];

  try {
    const result = await reservationModel.cancelReservation(15, {
      actor: 'customer',
      userId: 10,
      refundBankAccountId: '8',
    });

    assert.equal(result.depositStatus, 'dang_hoan');
    assert.deepEqual(
      state.calls.find(({ sql }) => sql.includes('FROM user_refund_bank_accounts')).params,
      [8, 10]
    );
    assert.deepEqual(
      state.calls.find(({ sql }) => sql.includes("SET status = 'dang_hoan'")).params,
      ['VCB', '123456789', 'NGUYEN VAN A', 44]
    );
    assert.equal(state.committed, true);
    assert.equal(state.rolledBack, false);
  } finally {
    pool.getConnection = originalGetConnection;
    pool.query = originalQuery;
  }
});

test('refund cancellation rejects an account that does not belong to the customer', async () => {
  const originalGetConnection = pool.getConnection;
  const originalQuery = pool.query;
  const state = createRefundCancellationConnection([]);
  pool.getConnection = async () => state.connection;
  pool.query = async () => [[], []];

  try {
    await assert.rejects(
      reservationModel.cancelReservation(15, {
        actor: 'customer',
        userId: 10,
        refundBankAccountId: '8',
      }),
      (error) => error.status === 400 && error.message === 'Tài khoản nhận hoàn cọc không hợp lệ.'
    );
    assert.equal(state.calls.some(({ sql }) => sql.startsWith('UPDATE reservations')), false);
    assert.equal(state.committed, false);
    assert.equal(state.rolledBack, true);
  } finally {
    pool.getConnection = originalGetConnection;
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
