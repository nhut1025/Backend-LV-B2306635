require('dotenv').config();

const bcrypt = require('bcrypt');
const { pool } = require('../src/config/db');

const args = new Map(
  process.argv.slice(2)
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const separator = arg.indexOf('=');
      return separator < 0
        ? [arg.slice(2), true]
        : [arg.slice(2, separator), arg.slice(separator + 1)];
    })
);

function option(name, fallback) {
  return args.has(name) ? args.get(name) : fallback;
}

function integerOption(name, fallback, minimum, maximum) {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`--${name} phải là số nguyên từ ${minimum} đến ${maximum}.`);
  }
  return value;
}

function createRandom(seed) {
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const seed = option('seed', `${Date.now()}`);
const random = createRandom(seed);

function pick(items) {
  return items[Math.floor(random() * items.length)];
}

function weightedPick(items, weightFor) {
  const weights = items.map((item) => Math.max(0, weightFor(item)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return pick(items);

  let target = random() * total;
  for (let index = 0; index < items.length; index += 1) {
    target -= weights[index];
    if (target <= 0) return items[index];
  }
  return items[items.length - 1];
}

function randomInt(minimum, maximum) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function randomPhone(index) {
  return `09${String(index).padStart(8, '0')}`.slice(-10);
}

const firstNames = [
  'An', 'Bình', 'Duy', 'Hà', 'Hạnh', 'Hiếu', 'Huy', 'Khánh', 'Lan', 'Linh',
  'Mai', 'Minh', 'My', 'Nam', 'Ngân', 'Ngọc', 'Phúc', 'Quân', 'Thảo', 'Trang',
  'Tuấn', 'Vy',
];
const lastNames = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Võ', 'Đặng', 'Bùi'];
const notes = ['Ít cay', 'Không hành', 'Ít ngọt', 'Để riêng nước chấm'];

// These are assumed synthetic co-ordering patterns, not observed restaurant behavior.
const pairRules = [
  { when: 'Lẩu Thái hải sản đặc biệt', with: ['Rau muống xào tỏi', 'Bia Tiger Crystal (Lon 330ml)'], probability: 0.7 },
  { when: 'Lẩu riêu cua bắp bò', with: ['Rau muống xào tỏi', 'Bia Saigon Special (Lon 330ml)'], probability: 0.7 },
  { when: 'Lẩu gà lá é Đà Lạt', with: ['Bia Tiger Nâu (Lon 330ml)'], probability: 0.7 },
  { when: 'Bún chả Hà Nội nướng than', with: ['Chả giò hải sản', 'Pepsi (Lon 320ml)'], probability: 0.6 },
  { when: 'Bánh xèo miền Tây đặc biệt', with: ['Gỏi ngó sen tôm thịt'], probability: 0.5 },
  { when: 'Mực trứng chiên mắm bơ tỏi', with: ['Bia 333 (Lon 330ml)'], probability: 0.6 },
  { when: 'Cơm tấm sườn bi chả mỡ hành', with: ['Coca-Cola (Lon 320ml)'], probability: 0.5 },
  { when: 'Vịt quay tiêu bọc xôi chiên', with: ['Bia Budweiser (Lon 330ml)'], probability: 0.6 },
];

function customerIdentity(index) {
  const identityRandom = createRandom(`customer-identity:${index}`);
  return {
    fullName: `${lastNames[Math.floor(identityRandom() * lastNames.length)]} ${firstNames[Math.floor(identityRandom() * firstNames.length)]}`,
    email: `sim-customer-${String(index).padStart(4, '0')}@example.test`,
    phone: randomPhone(index),
  };
}

function expectedVisitCount(customerIndex, startVisit, customerCount) {
  const completedRounds = Math.floor(startVisit / customerCount);
  const customersInPartialRound = startVisit % customerCount;
  return completedRounds + (customerIndex < customersInPartialRound ? 1 : 0);
}

function validateCustomerVisitHistory(email, history, expected, startVisit) {
  const reservations = Number(history ? history.reservation_count : 0);
  const paidBills = Number(history ? history.paid_bill_count : 0);
  const unfinishedBills = Number(history ? history.unfinished_bill_count : 0);
  if (
    reservations !== expected
    || paidBills !== expected
    || unfinishedBills > 0
  ) {
    throw new Error(
      `Từ chối chạy để tránh tạo bill trùng: ${email} có ${reservations} reservation, `
      + `${paidBills} bill đã thanh toán, ${unfinishedBills} bill chưa thanh toán; `
      + `batch hiện tại cần đúng ${expected} lượt đã hoàn tất trước --start-visit=${startVisit}. `
      + 'Chọn --customer-offset chưa dùng cho batch mới, hoặc kiểm tra và xử lý lượt dở dang trước khi tiếp tục.'
    );
  }
}

async function assertSimulationHistory(customerCount, customerOffset, startVisit) {
  const emails = Array.from(
    { length: customerCount },
    (_, index) => customerIdentity(customerOffset + index + 1).email
  );
  const [rows] = await pool.query(
    `SELECT u.email,
            COUNT(DISTINCT r.id) AS reservation_count,
            COUNT(DISTINCT CASE
              WHEN b.status = 'da_thanh_toan' AND b.payment_method IS NOT NULL THEN b.id
            END) AS paid_bill_count,
            COUNT(DISTINCT CASE
              WHEN b.id IS NOT NULL
               AND (b.status <> 'da_thanh_toan' OR b.payment_method IS NULL) THEN b.id
            END) AS unfinished_bill_count
     FROM users u
     LEFT JOIN reservations r ON r.user_id = u.id
     LEFT JOIN bills b ON b.reservation_id = r.id
     WHERE u.email IN (?)
     GROUP BY u.id, u.email`,
    [emails]
  );
  const historyByEmail = new Map(rows.map((row) => [row.email, row]));

  for (let customerIndex = 0; customerIndex < customerCount; customerIndex += 1) {
    const email = emails[customerIndex];
    const expected = expectedVisitCount(customerIndex, startVisit, customerCount);
    validateCustomerVisitHistory(
      email,
      historyByEmail.get(email),
      expected,
      startVisit
    );
  }
}

function createPreferenceProfile(dishes, customerKey) {
  const profileRandom = createRandom(`customer-profile:${customerKey}`);
  const profileRandomInt = (minimum, maximum) => (
    minimum + Math.floor(profileRandom() * (maximum - minimum + 1))
  );
  const categories = [...new Set(dishes.map((dish) => dish.category || 'Khác'))];
  const preferredCategories = new Set(
    categories
      .map((category) => ({ category, score: profileRandom() }))
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.min(categories.length, profileRandomInt(1, Math.min(3, categories.length))))
      .map(({ category }) => category)
  );
  const ingredients = [...new Set(dishes.flatMap((dish) => dish.ingredients || []))].sort();
  const preferredIngredientCount = ingredients.length > 0
    ? profileRandomInt(Math.min(2, ingredients.length), Math.min(5, ingredients.length))
    : 0;
  const preferredIngredients = new Set(
    ingredients
      .map((ingredient) => ({ ingredient, score: profileRandom() }))
      .sort((left, right) => right.score - left.score)
      .slice(0, preferredIngredientCount)
      .map(({ ingredient }) => ingredient)
  );
  const favoriteDishCount = profileRandomInt(
    Math.min(2, dishes.length),
    Math.min(4, dishes.length)
  );
  const favoriteDishIds = new Set(
    dishes
      .map((dish) => ({
        dish,
        score: profileRandom()
          + (preferredCategories.has(dish.category || 'Khác') ? 1 : 0)
          + ((dish.ingredients || []).some((ingredient) => preferredIngredients.has(ingredient)) ? 1 : 0),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, favoriteDishCount)
      .map(({ dish }) => Number(dish.id))
  );
  return {
    preferredCategories,
    preferredIngredients,
    favoriteDishIds,
    priceSensitivity: profileRandom() * 1.3,
  };
}

function isDishPreferred(dish, profile) {
  return profile.preferredCategories.has(dish.category || 'Khác')
    || (dish.ingredients || []).some((ingredient) => profile.preferredIngredients.has(ingredient));
}

function chooseDishes(
  dishes,
  count,
  profile,
  popularity,
  excludedIds = new Set(),
  preferenceStrength = 0.4
) {
  const selected = [];
  const available = dishes.filter((dish) => !excludedIds.has(Number(dish.id)));
  const pool = [...available];

  while (selected.length < count && pool.length > 0) {
    const dish = weightedPick(pool, (item) => {
      const category = item.category || 'Khác';
      const categoryWeight = profile.preferredCategories.has(category)
        ? 1 + 5.5 * preferenceStrength
        : 1;
      const ingredientWeight = (item.ingredients || []).some(
        (ingredient) => profile.preferredIngredients.has(ingredient)
      ) ? 1 + 3.5 * preferenceStrength : 1;
      const averagePrice = Math.max(1, Number(item.price));
      const priceWeight = 1 / Math.pow(averagePrice / 100000, profile.priceSensitivity);
      const popularityWeight = 1 + Math.min(2, (popularity.get(Number(item.id)) || 0) * 0.08);
      return categoryWeight * ingredientWeight * priceWeight * popularityWeight;
    });
    selected.push(dish);
    pool.splice(pool.indexOf(dish), 1);
  }
  return selected;
}

function quantityFor(dish) {
  const type = dishType(dish);
  if (type === 'drink' || type === 'side') {
    return random() < 0.28 ? 2 : 1;
  }
  return random() < 0.12 ? 2 : 1;
}

function normalizeCategory(category) {
  return String(category || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/đ/g, 'd');
}

function dishType(dish) {
  const category = normalizeCategory(dish.category);
  if (category === 'nuoc' || /(do uong|thuc uong|nuoc uong|beverage|drink)/.test(category)) return 'drink';
  if (/(trang mieng|dessert)/.test(category)) return 'dessert';
  if (/(khai vi|an kem|mon phu|appetizer|side)/.test(category)) return 'side';
  if (category === 'com' || /(mon chinh|mon nhau|main)/.test(category)) return 'main';
  return 'other';
}

function makeItems(
  dishes,
  profile,
  popularity,
  minCount,
  maxCount,
  excludedIds,
  preferenceStrength
) {
  const count = randomInt(minCount, Math.min(maxCount, dishes.length - excludedIds.size));
  return chooseDishes(
    dishes,
    count,
    profile,
    popularity,
    excludedIds,
    preferenceStrength
  ).map((dish) => ({
    dish,
    quantity: quantityFor(dish),
    note: random() < 0.08 ? pick(notes) : null,
  }));
}

function makeMealItems(
  dishes,
  profile,
  popularity,
  partySize,
  excludedIds,
  preferenceStrength
) {
  const available = dishes.filter((dish) => !excludedIds.has(Number(dish.id)));
  const selected = [];
  const selectedIds = new Set(excludedIds);
  const addDishes = (candidates, count, quantityForDish = () => 1) => {
    const choices = chooseDishes(
      candidates.filter((dish) => !selectedIds.has(Number(dish.id))),
      Math.min(count, candidates.filter((dish) => !selectedIds.has(Number(dish.id))).length),
      profile,
      popularity,
      selectedIds,
      preferenceStrength
    );
    for (const dish of choices) {
      const quantity = quantityForDish(dish);
      selected.push({ dish, quantity, note: random() < 0.06 ? pick(notes) : null });
      selectedIds.add(Number(dish.id));
    }
    return choices.length;
  };

  const favorites = available.filter((dish) => (
    profile.favoriteDishIds.has(Number(dish.id))
  ));
  if (favorites.length > 0 && random() < preferenceStrength) {
    addDishes(favorites, 1, (dish) => quantityFor(dish));
  }

  const mains = available.filter((dish) => dishType(dish) === 'main');
  const foodFallback = available.filter((dish) => dishType(dish) !== 'drink');
  const mainCandidates = mains.length > 0 ? mains : foodFallback;
  const mainPortions = Math.max(1, Math.ceil(partySize / 2));
  const mainCandidateIds = new Set(mainCandidates.map((dish) => Number(dish.id)));
  const selectedMainCount = selected.filter(({ dish }) => (
    mainCandidateIds.has(Number(dish.id))
  )).length;
  const mainCount = addDishes(
    mainCandidates,
    Math.max(0, mainPortions - selectedMainCount)
  );
  const totalMainCount = selectedMainCount + mainCount;
  if (totalMainCount === 0) {
    throw new Error('Không tìm thấy món ăn phù hợp để tạo bill (chỉ còn đồ uống hoặc không còn món).');
  }
  if (totalMainCount < mainPortions) {
    const firstMain = selected.find(({ dish }) => (
      mainCandidateIds.has(Number(dish.id))
    ));
    firstMain.quantity += mainPortions - totalMainCount;
  }

  const sides = available.filter((dish) => dishType(dish) === 'side');
  if (sides.length > 0 && random() < 0.65) {
    addDishes(sides, Math.min(sides.length, randomInt(1, Math.min(2, Math.ceil(partySize / 2)))));
  }

  const dishesByName = new Map(available.map((dish) => [dish.name, dish]));
  for (const { dish } of [...selected]) {
    for (const rule of pairRules.filter((candidate) => candidate.when === dish.name)) {
      for (const companionName of rule.with) {
        const companion = dishesByName.get(companionName);
        if (
          !companion
          || selectedIds.has(Number(companion.id))
          || random() >= rule.probability
        ) continue;
        const quantity = dishType(companion) === 'drink'
          ? Math.max(1, Math.ceil(partySize / 2))
          : 1;
        selected.push({ dish: companion, quantity, note: null });
        selectedIds.add(Number(companion.id));
      }
    }
  }

  const drinks = available.filter((dish) => (
    dishType(dish) === 'drink' && !selectedIds.has(Number(dish.id))
  ));
  if (drinks.length > 0 && random() < 0.85) {
    const drinkServings = Math.max(1, Math.ceil(partySize * (0.6 + random() * 0.4)));
    const drinkCount = Math.min(drinks.length, 2, drinkServings);
    const baseQuantity = Math.floor(drinkServings / drinkCount);
    const extraServings = drinkServings % drinkCount;
    let drinkIndex = 0;
    addDishes(drinks, drinkCount, () => {
      const quantity = baseQuantity + (drinkIndex < extraServings ? 1 : 0);
      drinkIndex += 1;
      return quantity;
    });
  }

  const desserts = available.filter((dish) => (
    dishType(dish) === 'dessert' && !selectedIds.has(Number(dish.id))
  ));
  if (desserts.length > 0 && random() < 0.25) {
    addDishes(desserts, 1, () => Math.max(1, Math.ceil(partySize / 3)));
  }

  return selected;
}

async function attachDishIngredients(dishes) {
  const dishIds = dishes.map((dish) => Number(dish.id));
  if (dishIds.length === 0) return dishes;
  const [rows] = await pool.query(
    `SELECT di.dish_id, i.name
     FROM dish_ingredients di
     JOIN ingredients i ON i.id = di.ingredient_id
     WHERE di.dish_id IN (?)
     ORDER BY di.dish_id, i.name`,
    [dishIds]
  );
  const ingredientsByDish = new Map();
  for (const row of rows) {
    const dishId = Number(row.dish_id);
    if (!ingredientsByDish.has(dishId)) ingredientsByDish.set(dishId, []);
    ingredientsByDish.get(dishId).push(row.name);
  }
  return dishes.map((dish) => ({
    ...dish,
    ingredients: ingredientsByDish.get(Number(dish.id)) || [],
  }));
}

function warnAboutUnavailablePairRules(dishes) {
  const dishNames = new Set(dishes.map((dish) => dish.name));
  const missingNames = new Set(
    pairRules.flatMap((rule) => [rule.when, ...rule.with]).filter((name) => !dishNames.has(name))
  );
  if (missingNames.size > 0) {
    console.warn(
      `Cảnh báo: không áp dụng được quy tắc ghép món vì thiếu tên món trong danh sách đang bán: `
      + `${[...missingNames].join(', ')}.`
    );
  }
}

function dateAndTimeFor(visitIndex, rules) {
  const [openHour, openMinute] = rules.reservation_open_time.split(':').map(Number);
  const [closeHour, closeMinute] = rules.reservation_close_time.split(':').map(Number);
  const open = openHour * 60 + openMinute;
  const close = closeHour * 60 + closeMinute;
  const firstSlot = open + 60;
  const slotCount = Math.max(1, Math.floor((close - firstSlot) / 180) + 1);
  const dayOffset = 1 + Math.floor(visitIndex / slotCount);
  const slot = visitIndex % slotCount;
  const date = shiftDate(new Date().toISOString().slice(0, 10), dayOffset);
  const timeMinutes = Math.min(firstSlot + slot * 180, close - 30);
  const time = `${String(Math.floor(timeMinutes / 60)).padStart(2, '0')}:${String(timeMinutes % 60).padStart(2, '0')}`;
  return { date, time };
}

function shiftDate(date, days) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function historicalDateAndTime(visitIndex, totalVisits, customerCount, historyDays, rules) {
  const visitsPerCustomer = totalVisits / customerCount;
  const visitRound = Math.floor(visitIndex / customerCount);
  const customerPosition = visitIndex % customerCount;
  const roundStart = Math.floor((visitRound * historyDays) / visitsPerCustomer);
  const roundEnd = Math.floor(((visitRound + 1) * historyDays) / visitsPerCustomer) - 1;
  const roundLength = Math.max(1, roundEnd - roundStart + 1);
  const dayOffset = roundStart + Math.floor(
    (customerPosition * Math.max(0, roundLength - 1)) / Math.max(1, customerCount - 1)
  );
  const daysAgo = Math.max(1, historyDays - dayOffset);
  const date = shiftDate(new Date().toISOString().slice(0, 10), -daysAgo);
  const [openHour, openMinute] = rules.reservation_open_time.split(':').map(Number);
  const [closeHour, closeMinute] = rules.reservation_close_time.split(':').map(Number);
  const open = openHour * 60 + openMinute;
  const close = closeHour * 60 + closeMinute;
  const firstSlot = Math.min(open + 120, close - 180);
  const lastSlot = Math.max(firstSlot, close - 180);
  const slotCount = Math.max(1, Math.floor((lastSlot - firstSlot) / 180) + 1);
  const slot = visitIndex % slotCount;
  const timeMinutes = Math.min(firstSlot + slot * 180, lastSlot);
  const time = `${String(Math.floor(timeMinutes / 60)).padStart(2, '0')}:${String(timeMinutes % 60).padStart(2, '0')}`;
  return { date, time };
}

function timestampAt(date, time, minuteOffset = 0) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute + minuteOffset));
  return timestamp.toISOString().slice(0, 19).replace('T', ' ');
}

async function request(path, { token, method = 'GET', body } = {}) {
  const baseUrl = (process.env.SIM_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text || response.statusText };
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} trả ${response.status}: ${data.message || text}`);
  }
  return data;
}

async function login(email, password, expectedRole) {
  if (!email || !password) {
    throw new Error(`Thiếu thông tin đăng nhập ${expectedRole} trong biến môi trường.`);
  }
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (result.user.role !== expectedRole) {
    throw new Error(`Tài khoản ${email} phải có role=${expectedRole}, hiện là ${result.user.role}.`);
  }
  return result.token;
}

async function ensureCustomer(index, password) {
  const identity = customerIdentity(index);
  const passwordHash = await bcrypt.hash(password, 10);
  const [existing] = await pool.query(
    'SELECT id, role FROM users WHERE email = ?',
    [identity.email]
  );
  if (existing.length > 0 && existing[0].role !== 'customer') {
    throw new Error(`${identity.email} đã tồn tại nhưng không phải tài khoản customer.`);
  }

  if (existing.length > 0) {
    await pool.query(
      `UPDATE users
       SET full_name = ?, phone = ?, password_hash = ?, is_verified = TRUE, is_active = TRUE
       WHERE id = ?`,
      [identity.fullName, identity.phone, passwordHash, existing[0].id]
    );
  } else {
    await pool.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role, is_active, is_verified)
       VALUES (?, ?, ?, ?, 'customer', TRUE, TRUE)`,
      [identity.fullName, identity.email, identity.phone, passwordHash]
    );
  }
  return identity;
}

async function setVisitHistory({
  reservationId,
  billId,
  itemTimestamps,
  hasPreorder,
  hasReview,
  date,
  time,
}) {
  const conn = await pool.getConnection();
  const reservationCreatedAt = timestampAt(date, time, -90);
  const depositPaidAt = timestampAt(date, time, -60);
  const preorderContactedAt = timestampAt(date, time, -45);
  const preorderPreparedAt = timestampAt(date, time, -30);
  const billCreatedAt = timestampAt(date, time, hasPreorder ? -30 : 5);
  const billPaidAt = timestampAt(date, time, 75);
  const reviewCreatedAt = timestampAt(date, time, 90);

  try {
    // The API requires future reservation dates; after its full workflow succeeds,
    // replace execution timestamps with a consistent historical visit timeline.
    await conn.beginTransaction();
    const [reservationResult] = await conn.query(
      `UPDATE reservations SET reservation_date = ?, reservation_time = ?, created_at = ?
       WHERE id = ? AND status = 'hoan_thanh'`,
      [date, time, reservationCreatedAt, reservationId]
    );
    if (reservationResult.affectedRows !== 1) {
      throw new Error(`Reservation ${reservationId} chưa hoàn tất; không gán được ngày lịch sử.`);
    }

    const [depositResult] = await conn.query(
      `UPDATE deposits SET paid_at = ?
       WHERE reservation_id = ? AND status = 'da_tru_bill'`,
      [depositPaidAt, reservationId]
    );
    if (depositResult.affectedRows !== 1) {
      throw new Error(`Reservation ${reservationId} không có cọc đã trừ vào bill.`);
    }

    const [billResult] = await conn.query(
      `UPDATE bills SET created_at = ?, paid_at = ?
       WHERE id = ? AND status = 'da_thanh_toan'`,
      [billCreatedAt, billPaidAt, billId]
    );
    if (billResult.affectedRows !== 1) {
      throw new Error(`Bill ${billId} chưa thanh toán; không gán được ngày lịch sử.`);
    }

    for (const [itemId, createdAt] of itemTimestamps) {
      const [itemResult] = await conn.query(
        'UPDATE bill_items SET created_at = ? WHERE id = ? AND bill_id = ? AND deleted_at IS NULL',
        [createdAt, itemId, billId]
      );
      if (itemResult.affectedRows !== 1) {
        throw new Error(`Không cập nhật được thời gian món bill_item #${itemId}.`);
      }
    }

    if (hasPreorder) {
      const [preorderResult] = await conn.query(
        `UPDATE reservation_preorders
         SET created_at = ?, contacted_at = ?, prepared_at = ?
         WHERE reservation_id = ? AND preparation_status = 'da_dua_vao_bill'`,
        [reservationCreatedAt, preorderContactedAt, preorderPreparedAt, reservationId]
      );
      if (preorderResult.affectedRows !== 1) {
        throw new Error(`Reservation ${reservationId} chưa hoàn tất món đặt trước.`);
      }
      await conn.query(
        'UPDATE reservation_preorder_items SET created_at = ? WHERE reservation_id = ?',
        [reservationCreatedAt, reservationId]
      );
    }

    if (hasReview) {
      const [reviewResult] = await conn.query(
        'UPDATE bill_reviews SET created_at = ?, updated_at = ? WHERE bill_id = ?',
        [reviewCreatedAt, reviewCreatedAt, billId]
      );
      if (reviewResult.affectedRows !== 1) {
        throw new Error(`Bill ${billId} không có đánh giá cần gán thời gian.`);
      }
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

function randomPaymentMethod(onlineAvailable, onlineRatio) {
  return onlineAvailable && random() < onlineRatio ? 'online' : 'tien_mat';
}

async function runVisit({
  identity,
  customerToken,
  serviceToken,
  kitchenToken,
  cashierToken,
  dishes,
  profile,
  popularity,
  rules,
  visitIndex,
  totalVisits,
  customerCount,
  historyDays,
  onlineAvailable,
  onlineRatio,
  preorderRate,
  reviewRate,
  preferenceStrength,
}) {
  const partySize = randomInt(1, 6);
  const tableSuggestion = await request(
    `/api/reservations/suggest-tables?party_size=${partySize}`,
    { token: customerToken }
  );
  const tableIds = tableSuggestion.tables.map((table) => Number(table.id));
  const tableId = tableIds[0];
  const { date, time } = dateAndTimeFor(visitIndex, rules);
  const profileDishIds = new Set();
  const usePreorder = dishes.length > 2 && random() < preorderRate;
  const preorderItems = usePreorder
    ? makeItems(
      dishes,
      profile,
      popularity,
      1,
      2,
      profileDishIds,
      preferenceStrength
    )
    : [];
  for (const item of preorderItems) {
    profileDishIds.add(Number(item.dish.id));
  }

  const reservation = await request('/api/reservations', {
    token: customerToken,
    method: 'POST',
    body: {
      party_size: partySize,
      reservation_date: date,
      reservation_time: time,
      phone: identity.phone,
      table_ids: tableIds,
      ...(preorderItems.length > 0
        ? {
            preorder_items: preorderItems.map(({ dish, quantity, note }) => ({
              dish_id: Number(dish.id),
              quantity,
              ...(note ? { note } : {}),
            })),
          }
        : {}),
    },
  });
  const reservationId = Number(reservation.reservation_id);
  console.log(
    `Đã tạo reservation #${reservationId} cho ${identity.email}; `
    + `nếu lượt này lỗi giữa chừng, kiểm tra trạng thái reservation này.`
  );

  if (onlineAvailable) {
    await request(`/api/reservations/${reservationId}/deposit-qr`, {
      token: customerToken,
    });
  }
  await request(`/api/reservations/${reservationId}/confirm-deposit`, {
    token: cashierToken,
    method: 'PATCH',
    body: {},
  });

  let preorderBillId = null;
  const itemIds = [];
  const billItemDishes = new Map();
  const itemTimestamps = new Map();
  const { date: historyDate, time: historyTime } = historicalDateAndTime(
    visitIndex,
    totalVisits,
    customerCount,
    historyDays,
    rules
  );
  const preorderItemTime = timestampAt(historyDate, historyTime, -30);
  if (preorderItems.length > 0) {
    await request(`/api/reservations/${reservationId}/preorder/contact`, {
      token: cashierToken,
      method: 'PATCH',
      body: { result: 'da_xac_nhan' },
    });
    const prepared = await request(`/api/reservations/${reservationId}/preorder/prepare`, {
      token: cashierToken,
      method: 'POST',
      body: {},
    });
    preorderBillId = Number(prepared.bill_id);
  }

  await request(`/api/reservations/${reservationId}/confirm-arrival`, {
    token: serviceToken,
    method: 'PATCH',
    body: {},
  });

  const openBill = await request(`/api/bills/table/${tableId}`, { token: serviceToken });
  const billId = Number(openBill.bill.id);
  if (preorderBillId && billId !== preorderBillId) {
    throw new Error(`Reservation ${reservationId}: bill đặt trước không khớp bill tại bàn.`);
  }
  if (preorderItems.length > 0) {
    const preorderDishIds = new Set(preorderItems.map((item) => Number(item.dish.id)));
    const billPreorderItems = openBill.items.filter((item) => (
      preorderDishIds.has(Number(item.dish_id))
    ));
    if (billPreorderItems.length !== preorderItems.length) {
      throw new Error(
        `Bill ${billId}: API không trả đủ các món đặt trước `
        + `(${billPreorderItems.length}/${preorderItems.length}).`
      );
    }
    for (const item of billPreorderItems) {
      const itemId = Number(item.id);
      itemIds.push(itemId);
      billItemDishes.set(itemId, Number(item.dish_id));
      itemTimestamps.set(itemId, preorderItemTime);
    }
  }

  const orderItems = makeMealItems(
    dishes,
    profile,
    popularity,
    partySize,
    profileDishIds,
    preferenceStrength
  );
  let orderItemOffset = 10;
  for (const item of orderItems) {
    const added = await request(`/api/bills/${billId}/items`, {
      token: serviceToken,
      method: 'POST',
      body: {
        dish_id: Number(item.dish.id),
        quantity: item.quantity,
        ...(item.note ? { note: item.note } : {}),
      },
    });
    const billItem = added.items.find((row) => Number(row.dish_id) === Number(item.dish.id));
    if (!billItem) {
      throw new Error(`Bill ${billId}: API không trả lại món vừa gọi (${item.dish.name}).`);
    }
    if (!itemIds.includes(Number(billItem.id))) itemIds.push(Number(billItem.id));
    billItemDishes.set(Number(billItem.id), Number(item.dish.id));
    itemTimestamps.set(Number(billItem.id), timestampAt(historyDate, historyTime, orderItemOffset));
    orderItemOffset += 2;
    profileDishIds.add(Number(item.dish.id));
  }

  for (const itemId of itemIds) {
    await request(`/api/bills/items/${itemId}/advance`, {
      token: kitchenToken,
      method: 'PATCH',
      body: {},
    });
    await request(`/api/bills/items/${itemId}/advance`, {
      token: kitchenToken,
      method: 'PATCH',
      body: {},
    });
    await request(`/api/bills/items/${itemId}/serve`, {
      token: serviceToken,
      method: 'PATCH',
      body: {},
    });
  }

  const paymentSummary = await request(`/api/bills/${billId}/payment-summary`, {
    token: cashierToken,
  });
  const paymentMethod = randomPaymentMethod(
    onlineAvailable && Number(paymentSummary.summary.amount_due) > 0,
    onlineRatio
  );
  await request(`/api/bills/${billId}/payment-request`, {
    token: serviceToken,
    method: 'POST',
    body: { payment_method: paymentMethod },
  });
  await request(`/api/bills/${billId}/pay`, {
    token: cashierToken,
    method: 'PATCH',
    body: { payment_method: paymentMethod },
  });

  const hasReview = random() < reviewRate;
  if (hasReview) {
    const billDishesById = new Map(dishes.map((dish) => [Number(dish.id), dish]));
    const likedItemIds = itemIds.map((id) => {
      const dish = billDishesById.get(billItemDishes.get(id));
      const preferred = dish ? isDishPreferred(dish, profile) : false;
      return {
        bill_item_id: id,
        sentiment: random() < (preferred ? 0.9 : 0.65) ? 'like' : 'dislike',
      };
    });
    const likeRatio = likedItemIds.filter((item) => item.sentiment === 'like').length
      / likedItemIds.length;
    const rating = Math.max(1, Math.min(5, Math.round(2 + likeRatio * 3 + random())));
    const comments = [
      'Món ăn hợp khẩu vị, trải nghiệm tốt.',
      'Đồ ăn ổn, nhân viên phục vụ chu đáo.',
      'Không gian dễ chịu, sẽ cân nhắc quay lại.',
      'Một vài món chưa đúng khẩu vị nhưng nhìn chung hài lòng.',
    ];
    await request(`/api/bills/${billId}/review`, {
      token: customerToken,
      method: 'POST',
      body: {
        rating,
        food_rating: rating,
        service_rating: randomInt(3, 5),
        ambience_rating: randomInt(3, 5),
        comment: pick(comments),
        item_feedback: likedItemIds,
      },
    });
  }

  await setVisitHistory({
    reservationId,
    billId,
    itemTimestamps,
    hasPreorder: preorderItems.length > 0,
    hasReview,
    date: historyDate,
    time: historyTime,
  });

  for (const dishId of profileDishIds) {
    popularity.set(dishId, (popularity.get(dishId) || 0) + 1);
  }

  return {
    reservationId,
    billId,
    tableIds,
    partySize,
    itemCount: itemIds.length,
    totalAmount: Number(paymentSummary.summary.subtotal),
    amountDue: Number(paymentSummary.summary.amount_due),
    paymentMethod,
    items: [...preorderItems, ...orderItems]
      .map(({ dish, quantity }) => `${dish.name} x${quantity}`)
      .join(', '),
    date: historyDate,
    time: historyTime,
  };
}

async function main() {
  const customers = integerOption('customers', 20, 1, 200);
  const customerOffset = integerOption('customer-offset', 0, 0, 99999999);
  const visitsPerCustomer = integerOption('visits', 8, 1, 100);
  if (customerOffset + customers > 99999999) {
    throw new Error('--customer-offset + --customers không được vượt quá 99999999.');
  }
  const totalVisits = customers * visitsPerCustomer;
  const historyDays = integerOption('history-days', 180, 1, 3650);
  const startVisit = integerOption('start-visit', 0, 0, totalVisits);
  if (historyDays < visitsPerCustomer) {
    throw new Error('--history-days phải lớn hơn hoặc bằng --visits để các vòng ghé trải trên nhiều ngày.');
  }
  if (totalVisits > 1000) {
    throw new Error('Tối đa 1000 lượt mỗi lần chạy để tránh tạo dữ liệu quá lớn ngoài ý muốn.');
  }
  const preorderRate = Number(option('preorder-rate', 0.15));
  const onlineRatio = Number(option('online-ratio', 0.25));
  const reviewRate = Number(option('review-rate', 0.35));
  const preferenceStrength = Number(option('preference-strength', 0.4));
  const rates = [preorderRate, onlineRatio, reviewRate];
  if (rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 1)) {
    throw new Error('--preorder-rate, --online-ratio và --review-rate phải nằm trong khoảng 0..1.');
  }
  if (!Number.isFinite(preferenceStrength) || preferenceStrength < 0 || preferenceStrength > 1) {
    throw new Error('--preference-strength phải nằm trong khoảng 0..1.');
  }
  if (!args.has('execute')) {
    throw new Error('Chưa xác nhận ghi dữ liệu. Thêm cờ --execute để tiếp tục.');
  }
  const dbName = process.env.DB_NAME || '';
  const looksLikeNonProduction = /(test|dev|sim|local)/i.test(dbName);
  if (!looksLikeNonProduction && !args.has('allow-non-test-db')) {
    throw new Error(
      `DB_NAME=${dbName || '(chưa cấu hình)'} không giống database thử nghiệm. `
      + 'Dùng DB test/dev/sim hoặc xác nhận rõ bằng --allow-non-test-db.'
    );
  }
  await assertSimulationHistory(customers, customerOffset, startVisit);
  const serviceToken = await login(
    process.env.SIM_SERVICE_EMAIL,
    process.env.SIM_SERVICE_PASSWORD,
    'phuc_vu'
  );
  const kitchenToken = await login(
    process.env.SIM_KITCHEN_EMAIL,
    process.env.SIM_KITCHEN_PASSWORD,
    'kitchen'
  );
  const cashierToken = await login(
    process.env.SIM_CASHIER_EMAIL,
    process.env.SIM_CASHIER_PASSWORD,
    'thu_ngan'
  );
  const rules = await request('/api/settings/reservation-rules');
  const { dishes } = await request('/api/dishes?available_only=true');
  if (!dishes || dishes.length < 2) {
    throw new Error('Cần ít nhất 2 món đang phục vụ để tạo lượt gọi món.');
  }
  const dishesWithIngredients = await attachDishIngredients(dishes);
  const availablePairRuleNames = new Set(dishesWithIngredients.map((dish) => dish.name));
  const matchedPairRules = pairRules.filter((rule) => availablePairRuleNames.has(rule.when));
  warnAboutUnavailablePairRules(dishesWithIngredients);

  const [bankSettings] = await pool.query(
    `SELECT setting_key, setting_value FROM settings
     WHERE setting_key IN ('restaurant_bank_bin', 'restaurant_account_number')`
  );
  const bankValues = new Map(bankSettings.map((row) => [row.setting_key, row.setting_value]));
  const onlineAvailable = Boolean(
    bankValues.get('restaurant_bank_bin') && bankValues.get('restaurant_account_number')
  );
  const customerPassword = process.env.SIM_CUSTOMER_PASSWORD || 'Simulation@12345';
  const identities = [];
  for (let index = 1; index <= customers; index += 1) {
    identities.push(await ensureCustomer(customerOffset + index, customerPassword));
  }

  console.log(
    `Bắt đầu mô phỏng ${customers} khách x ${visitsPerCustomer} lượt `
    + `(mã khách ${customerOffset + 1}–${customerOffset + customers}); `
    + `seed=${seed}; database=${dbName}; online=${onlineAvailable ? 'có thể dùng' : 'không cấu hình, dùng tiền mặt'}.`
  );
  console.log(
    `Mỗi hồ sơ giữ 2–4 món ruột; xác suất gọi lại mỗi lượt=${preferenceStrength}; `
    + `quy tắc ghép món khớp tên kích hoạt=${matchedPairRules.length}/${pairRules.length}.`
  );
  console.log(
    `Ngày đặt bàn, cọc, gọi món, thanh toán được mô phỏng trong ${historyDays} ngày trước hôm nay.`
  );

  const popularity = new Map();
  let completed = startVisit;
  const customerTokens = new Map();
  const profiles = identities.map((identity) => (
    createPreferenceProfile(dishesWithIngredients, identity.email)
  ));
  for (let visitIndex = startVisit; visitIndex < totalVisits; visitIndex += 1) {
    const customerIndex = visitIndex % customers;
    const identity = identities[customerIndex];
    if (!customerTokens.has(customerIndex)) {
      customerTokens.set(
        customerIndex,
        await login(identity.email, customerPassword, 'customer')
      );
    }
    const result = await runVisit({
      identity,
      customerToken: customerTokens.get(customerIndex),
      serviceToken,
      kitchenToken,
      cashierToken,
      dishes: dishesWithIngredients,
      profile: profiles[customerIndex],
      popularity,
      rules,
      visitIndex,
      totalVisits,
      customerCount: customers,
      historyDays,
      onlineAvailable,
      onlineRatio,
      preorderRate,
      reviewRate,
      preferenceStrength,
    });
    completed += 1;
    console.log(
      `[${completed}/${totalVisits}] ${identity.email}: bill #${result.billId}, `
      + `${result.partySize} khách, ${result.itemCount} dòng món [${result.items}], `
      + `tổng ${result.totalAmount.toFixed(0)}, `
      + `còn thu ${result.amountDue.toFixed(0)}, ${result.paymentMethod}, `
      + `ngày ghé mô phỏng ${result.date} ${result.time}.`
    );
  }

  console.log(`Hoàn tất: ${completed} bill đã thanh toán. Seed để tái lập: ${seed}`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`Mô phỏng thất bại: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}

module.exports = {
  createPreferenceProfile,
  expectedVisitCount,
  makeMealItems,
  isDishPreferred,
  validateCustomerVisitHistory,
};
