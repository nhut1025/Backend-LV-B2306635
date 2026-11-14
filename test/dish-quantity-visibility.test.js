const assert = require('node:assert/strict');
const test = require('node:test');
const dishController = require('../src/controllers/dish.controller');
const dishModel = require('../src/models/dish.model');

async function getDishForUser(user) {
  const originalFindById = dishModel.findById;
  const originalFindExcludedIngredientIds = dishModel.findExcludedIngredientIds;
  dishModel.findById = async () => ({
    dishResult: [[{ id: 1, name: 'Món thử' }], []],
    ingredientResult: [[{ id: 10, name: 'Gạo', quantity_g: '125.00' }], []],
    imageResult: [[], []],
  });
  dishModel.findExcludedIngredientIds = async () => [];

  try {
    let responseBody;
    const response = {
      json(body) {
        responseBody = body;
      },
      status() {
        return this;
      },
    };

    await dishController.getById({ params: { id: '1' }, user }, response, (error) => {
      if (error) throw error;
    });

    return responseBody.dish.ingredients[0];
  } finally {
    dishModel.findById = originalFindById;
    dishModel.findExcludedIngredientIds = originalFindExcludedIngredientIds;
  }
}

test('hides ingredient quantities from customer accounts', async () => {
  const ingredient = await getDishForUser({ id: 2, role: 'customer' });

  assert.deepEqual(ingredient, { id: 10, name: 'Gạo' });
});

test('hides ingredient quantities from unauthenticated visitors', async () => {
  const ingredient = await getDishForUser(null);

  assert.deepEqual(ingredient, { id: 10, name: 'Gạo' });
});

test('keeps ingredient quantities visible to staff', async () => {
  const ingredient = await getDishForUser({ id: 3, role: 'manager' });

  assert.deepEqual(ingredient, { id: 10, name: 'Gạo', quantity_g: 125 });
});
