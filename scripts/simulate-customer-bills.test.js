const assert = require('node:assert/strict');
const test = require('node:test');

const {
  expectedVisitCount,
  validateCustomerVisitHistory,
} = require('./simulate-customer-bills');

test('calculates completed visits for a partial round-robin batch', () => {
  assert.deepEqual(
    [0, 1, 2].map((customerIndex) => expectedVisitCount(customerIndex, 5, 3)),
    [2, 2, 1]
  );
});

test('rejects rerunning a batch whose customers already have paid bills', () => {
  assert.throws(
    () => validateCustomerVisitHistory(
      'sim-customer-0101@example.test',
      { reservation_count: 1, paid_bill_count: 1, unfinished_bill_count: 0 },
      0,
      0
    ),
    /tránh tạo bill trùng/
  );
});

test('allows resume only when prior visits are complete and match start-visit', () => {
  assert.doesNotThrow(
    () => validateCustomerVisitHistory(
      'sim-customer-0101@example.test',
      { reservation_count: '1', paid_bill_count: '1', unfinished_bill_count: '0' },
      1,
      30
    )
  );
  assert.throws(
    () => validateCustomerVisitHistory(
      'sim-customer-0101@example.test',
      { reservation_count: 1, paid_bill_count: 0, unfinished_bill_count: 1 },
      1,
      30
    ),
    /tránh tạo bill trùng/
  );
});
