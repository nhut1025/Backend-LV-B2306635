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

Manager staff endpoints:

- `GET /api/users/staff`
- `POST /api/users/staff`
- `PUT /api/users/staff/:id`
- `PATCH /api/users/staff/:id/active` with `{ "is_active": true|false }`

For real email delivery, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, and `MAIL_FROM` in `.env`. Without SMTP settings, links are
printed to the server console for local development.
