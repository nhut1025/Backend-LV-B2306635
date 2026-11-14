const assert = require('node:assert/strict');
const test = require('node:test');
const dishModel = require('../src/models/dish.model');

function createConnection(existingIngredients) {
  let insertedIngredients = [];
  return {
    get insertedIngredients() {
      return insertedIngredients;
    },
    async query(sql, params = []) {
      const statement = sql.trim();
      if (statement.startsWith('SELECT id FROM dishes')) {
        return [[{ id: 1 }], []];
      }
      if (statement.startsWith('SELECT ingredient_id, quantity_g')) {
        return [existingIngredients, []];
      }
      if (statement.startsWith('INSERT INTO dish_ingredients')) {
        [insertedIngredients] = params;
      }
      return [{ affectedRows: 1 }, []];
    },
  };
}

const dishFields = {
  name: 'Món thử',
  description: null,
  price: 1000,
  categoryName: null,
  categoryId: null,
  imageUrls: [],
};

test('preserves existing quantities when updating with ingredient IDs without quantities', async () => {
  const connection = createConnection([
    { ingredient_id: 10, quantity_g: '125.00' },
    { ingredient_id: 20, quantity_g: null },
  ]);

  await dishModel.update(connection, 1, {
    ...dishFields,
    ingredients: [{ ingredient_id: 10 }, { ingredient_id: 30 }],
  });

  assert.deepEqual(connection.insertedIngredients, [
    [1, 10, '125.00'],
    [1, 30, null],
  ]);
});

test('allows an explicit null quantity to clear the amount', async () => {
  const connection = createConnection([
    { ingredient_id: 10, quantity_g: '125.00' },
  ]);

  await dishModel.update(connection, 1, {
    ...dishFields,
    ingredients: [{ ingredient_id: 10, quantity_g: null }],
  });

  assert.deepEqual(connection.insertedIngredients, [[1, 10, null]]);
});
