const assert = require('node:assert/strict');
const test = require('node:test');
const billModel = require('../src/models/bill.model');
const reservationModel = require('../src/models/reservation.model');
const socket = require('../src/utils/socket');

const emitted = [];
const originalEmitToRoom = socket.emitToRoom;
socket.emitToRoom = (...args) => emitted.push(args);
delete require.cache[require.resolve('../src/controllers/bill.controller')];
const billController = require('../src/controllers/bill.controller');

const originalModelMethods = {
  findBillByPaymentCode: billModel.findBillByPaymentCode,
  getPaymentSummary: billModel.getPaymentSummary,
  payBill: billModel.payBill,
};
const originalReservationModelMethods = {
  findDepositPaymentByTransactionCode: reservationModel.findDepositPaymentByTransactionCode,
  confirmDepositPayment: reservationModel.confirmDepositPayment,
};
const TEST_API_KEY = 'test-sepay-key';
process.env.SEPAY_API_KEY = TEST_API_KEY;

let billStatus = 'mo';
let paymentCalls = [];
let paymentAmount = 150000;
let depositStatus = 'cho_thanh_toan';
let reservationStatus = 'giu_tam';
let depositAmount = 100000;
let depositHoldValid = true;
let depositConfirmCalls = [];

function configureBillModel() {
  billStatus = 'mo';
  paymentCalls = [];
  paymentAmount = 150000;
  billModel.findBillByPaymentCode = async (code) => (
    code === 'BILL12'
      ? { id: 12, status: billStatus, payment_method: 'online' }
      : null
  );
  billModel.getPaymentSummary = async () => ({ summary: { amount_due: paymentAmount } });
  billModel.payBill = async (...args) => {
    paymentCalls.push(args);
    if (billStatus !== 'mo') {
      const error = new Error('Already paid');
      error.status = 409;
      throw error;
    }
    billStatus = 'da_thanh_toan';
    return { bill_id: 12, table_id: 2, total: paymentAmount };
  };
}

function configureReservationModel() {
  depositStatus = 'cho_thanh_toan';
  reservationStatus = 'giu_tam';
  depositAmount = 100000;
  depositHoldValid = true;
  depositConfirmCalls = [];
  reservationModel.findDepositPaymentByTransactionCode = async (code) => (
    code === 'COC15'
      ? {
        deposit_id: 27,
        reservation_id: 15,
        amount: depositAmount,
        transaction_code: code,
        deposit_status: depositStatus,
        reservation_status: reservationStatus,
        held_table_count: 1,
        invalid_held_table_count: depositHoldValid ? 0 : 1,
      }
      : null
  );
  reservationModel.confirmDepositPayment = async (...args) => {
    depositConfirmCalls.push(args);
    if (depositStatus !== 'cho_thanh_toan' || reservationStatus !== 'giu_tam' || !depositHoldValid) {
      const error = new Error('Deposit cannot be confirmed');
      error.status = 409;
      throw error;
    }
    depositStatus = 'da_coc';
    reservationStatus = 'da_dat';
    return {
      deposit_id: 27,
      reservation_id: 15,
      transaction_code: 'COC15',
      amount: depositAmount,
    };
  };
}

async function postWebhook({ authorization, body }) {
  let statusCode = 200;
  let responseBody;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      responseBody = payload;
      return this;
    },
  };
  await billController.sepayWebhook(
    { headers: { authorization }, body },
    response
  );
  return { statusCode, body: responseBody };
}

test.beforeEach(() => {
  configureBillModel();
  configureReservationModel();
  emitted.length = 0;
});

test.after(() => {
  billModel.findBillByPaymentCode = originalModelMethods.findBillByPaymentCode;
  billModel.getPaymentSummary = originalModelMethods.getPaymentSummary;
  billModel.payBill = originalModelMethods.payBill;
  reservationModel.findDepositPaymentByTransactionCode =
    originalReservationModelMethods.findDepositPaymentByTransactionCode;
  reservationModel.confirmDepositPayment = originalReservationModelMethods.confirmDepositPayment;
  socket.emitToRoom = originalEmitToRoom;
  delete process.env.SEPAY_API_KEY;
});

test('rejects a missing or incorrect SePay API key', async () => {
  const result = await postWebhook({
    authorization: 'Apikey wrong-key',
    body: { transferType: 'in', transferAmount: 150000, content: 'BILL12' },
  });

  assert.equal(result.statusCode, 401);
  assert.equal(billStatus, 'mo');
  assert.equal(paymentCalls.length, 0);
});

test('acknowledges but does not pay an underfunded transfer', async () => {
  const result = await postWebhook({
    authorization: `Apikey ${TEST_API_KEY}`,
    body: { transferType: 'in', transferAmount: 149999, content: 'BILL12' },
  });

  assert.deepEqual(result, { statusCode: 200, body: { success: true } });
  assert.equal(billStatus, 'mo');
  assert.equal(paymentCalls.length, 0);
});

test('confirms a valid incoming transfer and emits both payment events', async () => {
  const result = await postWebhook({
    authorization: `Apikey ${TEST_API_KEY}`,
    body: { transferType: 'in', transferAmount: 150000, content: 'BILL12' },
  });

  assert.deepEqual(result, { statusCode: 200, body: { success: true } });
  assert.equal(billStatus, 'da_thanh_toan');
  assert.deepEqual(paymentCalls, [[12, 'online', null]]);
  assert.deepEqual(emitted, [
    ['phuc_vu', 'service:bill-paid', { bill_id: 12, table_id: 2, total: 150000 }],
    ['thu_ngan', 'cashier:bill-paid', { bill_id: 12, table_id: 2, total: 150000 }],
  ]);
});

test('acknowledges a duplicate notification without paying twice', async () => {
  billStatus = 'da_thanh_toan';
  const result = await postWebhook({
    authorization: `Apikey ${TEST_API_KEY}`,
    body: { transferType: 'in', transferAmount: 150000, content: 'BILL12' },
  });

  assert.deepEqual(result, { statusCode: 200, body: { success: true } });
  assert.equal(paymentCalls.length, 0);
});

test('ignores outgoing transfers and unmatched bill codes', async () => {
  const outgoing = await postWebhook({
    authorization: `Apikey ${TEST_API_KEY}`,
    body: { transferType: 'out', transferAmount: 150000, content: 'BILL12' },
  });
  const unmatched = await postWebhook({
    authorization: `Apikey ${TEST_API_KEY}`,
    body: { transferType: 'in', transferAmount: 150000, content: 'BILL999' },
  });

  assert.deepEqual(outgoing, { statusCode: 200, body: { success: true } });
  assert.deepEqual(unmatched, { statusCode: 200, body: { success: true } });
  assert.equal(paymentCalls.length, 0);
  assert.equal(emitted.length, 0);
});

test('treats a concurrent already-paid conflict as an idempotent success', async () => {
  billModel.payBill = async () => {
    billStatus = 'da_thanh_toan';
    const error = new Error('Already paid by a concurrent notification');
    error.status = 409;
    throw error;
  };
  const result = await postWebhook({
    authorization: `Apikey ${TEST_API_KEY}`,
    body: { transferType: 'in', transferAmount: 150000, content: 'BILL12' },
  });

  assert.deepEqual(result, { statusCode: 200, body: { success: true } });
});

test('does not acknowledge a payment conflict while the bill remains open', async () => {
  billModel.payBill = async () => {
    const error = new Error('Items have not been served yet');
    error.status = 409;
    throw error;
  };
  const result = await postWebhook({
    authorization: `Apikey ${TEST_API_KEY}`,
    body: { transferType: 'in', transferAmount: 150000, content: 'BILL12' },
  });

  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.body, { success: false });
  assert.equal(billStatus, 'mo');
});

test('confirms a valid incoming deposit transfer by its stored transaction code', async () => {
  const result = await postWebhook({
    authorization: `Apikey ${TEST_API_KEY}`,
    body: { transferType: 'in', transferAmount: 100000, content: 'Khach chuyen COC15' },
  });

  assert.deepEqual(result, { statusCode: 200, body: { success: true } });
  assert.equal(depositStatus, 'da_coc');
  assert.equal(reservationStatus, 'da_dat');
  assert.deepEqual(depositConfirmCalls, [[27, null]]);
  assert.deepEqual(emitted, [[
    'thu_ngan',
    'cashier:deposit-confirmed',
    { deposit_id: 27, reservation_id: 15, transaction_code: 'COC15', amount: 100000 },
  ]]);
});

test('acknowledges but does not confirm an underfunded deposit transfer', async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const result = await postWebhook({
      authorization: `Apikey ${TEST_API_KEY}`,
      body: { transferType: 'in', transferAmount: 50000, code: 'COC15' },
    });

    assert.deepEqual(result, { statusCode: 200, body: { success: true } });
    assert.equal(depositStatus, 'cho_thanh_toan');
    assert.equal(depositConfirmCalls.length, 0);
    assert.match(warnings[0][0], /COC15 chuyển thiếu/);
  } finally {
    console.warn = originalWarn;
  }
});

test('confirms an overfunded deposit and warns about the excess', async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const result = await postWebhook({
      authorization: `Apikey ${TEST_API_KEY}`,
      body: { transferType: 'in', transferAmount: 150000, code: 'COC15' },
    });

    assert.deepEqual(result, { statusCode: 200, body: { success: true } });
    assert.equal(depositStatus, 'da_coc');
    assert.deepEqual(depositConfirmCalls, [[27, null]]);
    assert.match(warnings[0][0], /COC15 chuyển thừa/);
    assert.equal(warnings[0][1], 50000);
  } finally {
    console.warn = originalWarn;
  }
});

test('does not confirm an expired held reservation and notifies the cashier', async () => {
  depositHoldValid = false;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await postWebhook({
      authorization: `Apikey ${TEST_API_KEY}`,
      body: { transferType: 'in', transferAmount: 100000, code: 'COC15' },
    });

    assert.deepEqual(result, { statusCode: 200, body: { success: true } });
    assert.equal(depositStatus, 'cho_thanh_toan');
    assert.equal(depositConfirmCalls.length, 0);
    assert.deepEqual(emitted, [[
      'thu_ngan',
      'cashier:deposit-late-payment',
      {
        deposit_id: 27,
        reservation_id: 15,
        transaction_code: 'COC15',
        transfer_amount: 100000,
        deposit_amount: 100000,
        reason: 'hold_expired_or_invalid',
      },
    ]]);
  } finally {
    console.warn = originalWarn;
  }
});

test('ignores already-confirmed deposit notifications', async () => {
  depositStatus = 'da_coc';
  reservationStatus = 'da_dat';
  const result = await postWebhook({
    authorization: `Apikey ${TEST_API_KEY}`,
    body: { transferType: 'in', transferAmount: 100000, content: 'COC15' },
  });

  assert.deepEqual(result, { statusCode: 200, body: { success: true } });
  assert.equal(depositConfirmCalls.length, 0);
  assert.equal(emitted.length, 0);
});

test('acknowledges a concurrent manual confirmation without paying twice', async () => {
  reservationModel.confirmDepositPayment = async () => {
    depositStatus = 'da_coc';
    reservationStatus = 'da_dat';
    const error = new Error('Already confirmed by cashier');
    error.status = 409;
    throw error;
  };

  const result = await postWebhook({
    authorization: `Apikey ${TEST_API_KEY}`,
    body: { transferType: 'in', transferAmount: 100000, content: 'COC15' },
  });

  assert.deepEqual(result, { statusCode: 200, body: { success: true } });
  assert.equal(emitted.length, 0);
});
