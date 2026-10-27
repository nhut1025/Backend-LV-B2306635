# Backend

## Setup

```bash
npm install
copy .env.example .env
npm run dev
```

Set the database and JWT values in `.env` before starting the server.

## Database

Run `database/schema.sql`, then `database/seed.sql` in MySQL. The seed creates
the `settings` values used by table validation and a manager account.
The seeded manager login is `dmn19102005@gmail.com` / `Nhut@1025`.

### Dish categories

On an existing database, run `database/v9_dish_categories_migration.sql` once
before starting this version. It creates the managed category table and links
existing dish category names without deleting their current values. New
installations use the schema in `database/full_setup_database.sql`.

For multiple dish images, also run `database/v10_dish_images_migration.sql`
once after the categories migration. It matches the `dish_images.dish_id`
type to the existing `dishes.id` type, including its signed/unsigned setting.

- `GET /api/categories` lists categories and the number of assigned dishes.
- Managers can add, rename, and delete categories with
  `POST /api/categories` (`{ "name": "..." }`),
  `PUT /api/categories/:id` (`{ "name": "..." }`), and
  `DELETE /api/categories/:id`. Deleting a category assigned to dishes returns
  `409`; reassign those dishes first.
- Dish create/update accepts `category_id`. The legacy `category` name is
  still accepted if it matches an existing category, and dish responses
  continue returning `category` as the display name.
- `GET /api/dishes?category_id=<id>` filters by category ID; the existing
  `category=<name>` filter remains supported.
- On an existing database, run `database/v10_dish_images_migration.sql` once
  to create the dish image gallery and migrate each current `image_url` as its
  first image. Dish create/update accepts `image_urls` (up to 10 URLs) and
  continues setting the first URL as the legacy `image_url`. Dish detail
  returns an ordered `images` array; image upload remains manager-only at
  `POST /api/dishes/upload-image`.
  - On an existing database, run `database/v11_phase8_refunds_migration.sql`
    once to add refund attribution, forfeiture timestamps, and the cancelled
    deposit status used by reservation cancellations.
  - Ingredient management already supports public `GET /api/ingredients` and
  manager-only create, rename, and delete endpoints under `/api/ingredients`.

Authentication endpoints are mounted under `/api/auth`:

- `POST /forgot-password` with `{ "email": "..." }`
- `POST /reset-password` with `{ "token": "...", "password": "..." }`

Managers can create internal accounts with `POST /api/users/staff` using a
Bearer token and `{ "full_name", "email", "password", "role": "phuc_vu|thu_ngan|kitchen|manager" }`.

## Bill Payment

When a guest asks to pay, service staff submits
`POST /api/bills/:billId/payment-request` with `{ "payment_method": "online" }`
or `{ "payment_method": "tien_mat" }`. The online response contains `qr_url`
and `payment_code`; the bill and table remain open while awaiting cashier
confirmation. Cashiers can also submit this request for guests paying directly
at the counter. Cashiers confirm receipt with
`PATCH /api/bills/:billId/pay` and the same `payment_method`; only then is the
bill closed and the table released. Cashiers can see pending methods in
`GET /api/bills/payable`.

Manager staff endpoints:

- `GET /api/users/staff`
- `POST /api/users/staff`
- `PUT /api/users/staff/:id`
- `PATCH /api/users/staff/:id/active` with `{ "is_active": true|false }`

For real email delivery, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, and `MAIL_FROM` in `.env`. Without SMTP settings, links are
printed to the server console for local development.

## Reservation Preorders

Before using preorder APIs on an existing database, run
`database/v8_reservation_preorders_migration.sql` once. New installations get
the preorder tables from `database/full_setup_database.sql`.

Customers may include `preorder_items` when creating a reservation with
`POST /api/reservations`:

```json
{
  "party_size": 4,
  "reservation_date": "2026-10-25",
  "reservation_time": "18:30",
  "phone": "0900000000",
  "table_ids": [3],
  "preorder_items": [
    { "dish_id": 12, "quantity": 2, "note": "Ít cay" }
  ]
}
```

Preorders are stored separately from bills and the kitchen queue until the
cashier confirms that the customer agreed and the food should be prepared:

- `GET /api/reservations/:id/preorder` — customer views their preorder.
- `GET /api/reservations/preorders/pending` — cashier lists unprepared orders.
- `PATCH /api/reservations/:id/preorder/contact` with
  `{ "result": "da_xac_nhan|khong_nghe_may|tu_choi" }` — cashier records the
  phone-call result.
- `POST /api/reservations/:id/preorder/prepare` — cashier confirms preparation;
  the API adds items to the reservation bill and emits `kitchen:item-added`.

The reservation must be confirmed (`da_dat`) before the cashier can record a
call or send the preorder to the kitchen. Repeating the prepare request does
not add duplicate bill items.

## Reservation Cancellations and Refunds

Customers can cancel an unpaid hold or an eligible reservation from
`/my-reservations`. A paid deposit is fully refundable when cancellation is at
least `cancellation_deadline_minutes` before the appointment (45 minutes by
default); the customer supplies their bank and account details. Later
cancellations and no-shows forfeit the deposit. No-show detection runs every
30 seconds and uses `no_show_buffer_minutes` (15 minutes by default).

Reservations cannot be cancelled by the customer or service staff after a
preorder has been added to a bill and sent to the kitchen. Eligible refund
requests appear in the manager-only `/pending-refunds` page. Managers transfer
the money outside the system, then confirm the refund there; the system records
the manager and completion time. The manager finance page includes completed
refunds and forfeited deposits in its deposit income/expense ledger.

- `PATCH /api/reservations/:id/cancel` — customer cancellation; refundable
  cancellations include `refund_bank_code`, `refund_account_number`, and
  `refund_account_name`. A late cancellation must include
  `accept_forfeiture: true`.
- `PATCH /api/reservations/:id/cancel-by-staff` — the same cancellation policy
  for service staff.
- `GET /api/reservations/pending-refunds` and
  `PATCH /api/reservations/:id/confirm-refund` — manager refund queue and
  confirmation after the manual bank transfer.
- `GET /api/finance/deposits?from=YYYY-MM-DD&to=YYYY-MM-DD` — completed refund
  and forfeited-deposit entries for the manager finance report.
