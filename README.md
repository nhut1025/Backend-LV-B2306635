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

### Chat with the restaurant

On an existing database, run `database/v16_chat_migration.sql` once. It adds
conversation close metadata, message attachment metadata, and lookup indexes
without replacing the existing chat tables. New installations include these
columns in `database/full_setup_database.sql`.

Only authenticated customers and cashiers can use `/api/chat`. Customers can
list their own conversations and send/read messages; cashiers share the open
inbox, claim a conversation by replying, take over an open conversation, and
close conversations assigned to them. Message text is limited to 1,500
characters. A single image, PDF, Word, Excel, CSV, or TXT attachment up to
20 MB can be sent with a message. Chat files are stored under the private
`storage/chat` directory and downloaded only through the authenticated
`GET /api/chat/messages/:messageId/attachment` endpoint.

- `GET /api/chat/conversations` and `GET /api/chat/unread-count` list inboxes
  and unread counts according to the caller's role.
- `GET /api/chat/conversations/:id/messages` loads history and marks incoming
  messages as read.
- `POST /api/chat/messages` accepts multipart fields `content`,
  `conversation_id` (required for cashiers; optional for customers), and
  `attachment`.
- Cashiers can take over with `PATCH /api/chat/conversations/:id/takeover`
  and close their assigned conversation with
  `PATCH /api/chat/conversations/:id/close`.

The frontend provides `/chat` for customers and cashiers. Realtime events use
the `chat:conversation-new`, `chat:message-new`, `chat:assigned`, `chat:closed`,
`chat:read`, and `chat:cashier-presence` names.

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

## Reservation Timing Settings

Managers can configure reservation timings at `/reservation-timing`. Values
are saved in the existing `settings` table, so existing databases need no
schema migration. The page controls booking hours, the payment hold, the
customer refund deadline, the staff no-show threshold, the staff restore
window, the table-transfer conflict duration, and the expired-hold scan
interval. Updating the scan interval reschedules the running job without a
server restart. Public booking forms and staff screens read the same values
from `GET /api/settings/reservation-rules`.
The full configuration is available to managers through
`GET/PUT /api/settings/reservation-timing`.

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
customer cancellations forfeit the deposit. A reservation is not automatically
marked as a no-show: service staff can cancel it after the customer is later
than `no_show_buffer_minutes` (15 minutes by default), at which point the
deposit is marked forfeited and its tables are released.
The customer reservation history shows who cancelled and when, whether a
deposit refund is pending, completed, or forfeited, and labels staff-cancelled
late arrivals as no-shows.

For 30 minutes after a service-staff cancellation, staff can restore the
reservation if suitable tables are available. The system restores the deposit
to `da_coc`, reuses the original tables when they are free, and otherwise
assigns a suitable free table combination. Voucher compensation is not part of
this flow.

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
  for service staff, with an additional 15-minute late-arrival requirement for
  confirmed reservations.
- `PATCH /api/reservations/:id/restore-after-cancel` — service staff restores a
  staff-cancelled, forfeited reservation within 30 minutes, subject to table
  availability.
- `GET /api/reservations/pending-refunds` and
  `PATCH /api/reservations/:id/confirm-refund` — manager refund queue and
  confirmation after the manual bank transfer.
- `GET /api/finance/deposits?from=YYYY-MM-DD&to=YYYY-MM-DD` — completed refund
  and forfeited-deposit entries for the manager finance report.

## Paid Bill Reviews

On an existing database, run `database/v12_bill_reviews_migration.sql` once.
New installations create the review tables from `database/full_setup_database.sql`.
On existing databases, run `database/v13_review_category_ratings_migration.sql`
after v12 to add food, service, and ambience ratings.
Run `database/v14_manager_review_replies_migration.sql` after v13 to enable
manager replies to reviews. Managers can manage replies at `/manage-reviews`;
replies are also shown on the restaurant review page and related dish feedback.
Customers can submit one 1-to-5-star rating and a required comment for each
paid bill, separate 1-to-5-star ratings for food, service, and ambience, and
choose like/dislike for each bill item. They can edit a review from their paid
bill history; reviews cannot be deleted.

The protected `/restaurant-reviews` page shows overall and category averages,
with filters and comments from paid bills. Public dish detail pages show
like/dislike totals and up to 30 recent comments relating to that dish.

- `POST /api/bills/:billId/review` — create a review for an owned, paid bill.
- `PUT /api/bills/:billId/review` — edit the existing review.
- `GET /api/bills/my-history` includes the bill review and each item's feedback.
- `GET /api/bills/reviews?rating=all|5|4|3|2&page=1` — restaurant-wide
  category averages and paginated paid-bill reviews (`2` filters 1–2 stars).
- `GET /api/dishes/:id/reviews` — public summary and recent reviews relating to
  that dish.

## Table Transfers

On an existing database, run `database/v15_table_transfers_migration.sql` once
after `database/v14_manager_review_replies_migration.sql`. New installations
include the transfer audit table and default duration in
`database/full_setup_database.sql`.

Service staff can move a confirmed reservation before arrival or move an
occupied table. Reservation transfers preserve the reservation and its
deposit, require enough combined capacity, and accept a list of destination
table IDs. Walk-in transfers accept one destination table; service staff is
responsible for checking that its capacity suits the party. Tables are locked
in ascending ID order in one transaction. Destination tables must be free and
must not overlap another confirmed reservation within the configured usage
window. Held reservations cannot be transferred.

An open bill moves to the lowest-ID destination table, which is the bill's
representative table. Transfers are rejected if a bill has a pending payment
method, is paid, or if the reservation has multiple open bills. Kitchen queue
items receive an update event with the new table number. Transfer attribution
is stored in `table_transfers`.

Managers configure the table-usage window (15–1440 minutes; 120 by default) at
`/table-transfer-settings`.

- `PATCH /api/reservations/:id/tables` — service staff transfers a reservation
  using `{ "table_ids": [2, 3] }`.
- `PATCH /api/tables/:id/move` — service staff moves a walk-in guest using
  `{ "to_table_id": 4 }`.
- `GET /api/tables/operational` — service staff table list including active
  reservation IDs and party sizes, for transfer controls.
- `GET /api/settings/table-transfer` and
  `PUT /api/settings/table-transfer` — manager reads/updates
  `{ "duration_minutes": 120 }`.
