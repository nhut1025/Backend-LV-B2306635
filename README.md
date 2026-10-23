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
