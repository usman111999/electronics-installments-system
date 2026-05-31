# Electronics Installments System

A complete management system for an electronics retailer that sells on installment plans across multiple branches. Built with **React + Node.js (Express) + Supabase**.

## Features

### Three role-based portals (one login, role auto-detected)
- **Admin** — full control: branches, products, users, all stats, activity logs, every branch's data.
- **Branch Operator** — manages inventory, customers, orders, installments, and WhatsApp for **their branch only**.
- **Customer** — sees their own account, orders, installments, balance, and the public product catalog.

### Core capabilities
- Multi-branch with strict data isolation per branch
- Full customer file: home + office addresses, two phones, picture URL, CNIC, occupation, income, CRC remarks
- Up to 3 guarantors per customer (name, F/H name, addresses, phones, CNIC, occupation, relation)
- Product catalog with images, base price, and default installment price
- Inventory with per-branch stock and serial numbers
- Orders with automatic installment plan generation
- Payment recording with receipts, discounts, fines, running balance
- Activity log of every change (admin auditable across all branches; operator scoped to their branch)
- WhatsApp reminders auto-sent on days 1–5 of every month for pending installments — pluggable providers (Twilio, Meta Cloud API, UltraMsg, or local-log)
- Printable Customer Account Information Detail page that mirrors the supplied paper form (downloadable / printable to PDF via browser)
- Dashboard charts: monthly collections, order status pie, orders-by-branch, top products
- KPIs: money in market, total collected, total sales, profit estimate, overdue count, stock, customers, branches
- **Device lock / unlock + location tracking** (electronics financed on installment) — operator-issued lock & unlock over FCM, HMAC-signed commands per the protocol in `docs/DEVICE_LOCK_PROTOCOL.md`, enrollment QR code, heartbeat + GPS history map (MapLibre + OpenStreetMap), auto-lock per branch policy (`branches.auto_lock_days`), 24-h pre-lock WhatsApp warning, SIM-swap alert, auto-unlock when payment clears the balance. Configure FCM via `FCM_SERVICE_ACCOUNT_JSON_PATH`/`FCM_PROJECT_ID` in `backend/.env`; with the provider unset everything runs in dev no-op mode.

## Repository layout

```
electronics instalments system/
├── backend/        Node.js + Express + Supabase service
├── frontend/       React (Vite) + Tailwind app
├── database/       SQL schema, RLS policies, seed data
└── README.md
```

## Prerequisites
- Node.js 18+ and npm
- A Supabase project (already provisioned — see credentials below)

## Step 1 — Apply the database schema

There is no Supabase Management API PAT, so the schema must be applied manually **once**:

1. Open the Supabase Dashboard for project `koldxkjvbifsszuhjrll`.
2. Open **SQL Editor → New query**.
3. Paste and run, in order:
   - `database/01_schema.sql`
   - `database/02_rls.sql`
   - `database/03_seed.sql`

That creates all tables, indexes, RLS policies, and one default branch + a few sample products.

## Step 2 — Backend

```bash
cd backend
npm install
npm run seed:admin     # creates admin@eis.local / Admin@123456
npm run dev            # starts on http://localhost:4000
```

Environment is preset in `backend/.env` with your Supabase keys. To enable real WhatsApp sending, edit `backend/.env`:

```bash
WHATSAPP_PROVIDER=ultramsg     # or twilio | meta | none
ULTRAMSG_INSTANCE_ID=...
ULTRAMSG_TOKEN=...
```

Cron is registered on server start. The reminder job runs every day at 09:30 and only emits messages when today is day 1–5 of the month. Admin can also run it manually from the WhatsApp page.

## Step 3 — Frontend

```bash
cd frontend
npm install
npm run dev            # starts on http://localhost:5173
```

Open http://localhost:5173 and sign in with the admin you created above. The login page is the same for every role — the system reads the user's profile and routes to the right portal.

## Default credentials after seeding

```
admin@eis.local
Admin@123456
```

**Change this password immediately on first login.**

## Customer Account Information Detail (print)

On any customer's page, click **Print Account Form**. The browser's print dialog opens with an A4 layout that includes header (branch name, dates), customer information block, guarantor table, and the full installment ledger. Save to PDF or print directly.

## Roles and what they can do

| Capability | Admin | Operator | Customer |
| --- | --- | --- | --- |
| See all branches | ✓ | own only | – |
| Create branch | ✓ | – | – |
| Create operator | ✓ | – | – |
| Create customer | ✓ | own branch | – |
| Catalog management | ✓ | – | – |
| Inventory in/out | ✓ | own branch | – |
| Create order + plan | ✓ | own branch | – |
| Record payment | ✓ | own branch | – |
| Activity log | global | own branch | – |
| WhatsApp send/log | ✓ | own branch | – |
| See own account | – | – | ✓ |
| Browse products | ✓ | ✓ | ✓ |

## WhatsApp providers

| Provider | When to use | Required env |
| --- | --- | --- |
| `none` (default) | dev / staging — logs messages to console | – |
| `twilio` | Twilio WhatsApp Business sender | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` |
| `meta` | Meta WhatsApp Cloud API | `META_WHATSAPP_TOKEN`, `META_WHATSAPP_PHONE_ID` |
| `ultramsg` | UltraMsg (low-cost, easy) | `ULTRAMSG_INSTANCE_ID`, `ULTRAMSG_TOKEN` |

## Production notes

- **Set strong secrets** in `backend/.env`, especially `JWT_SECRET` (used only as a fallback — Supabase tokens are the source of truth).
- Put the backend behind HTTPS, set `FRONTEND_URL` to your production origin.
- Run the schema in a clean Supabase project for production.
- Consider Supabase Storage for `picture_url` and `image_url` instead of external URLs.
- For Vercel deployment of the frontend: `vercel --prod` from `/frontend` after setting `VITE_API_BASE_URL` to your backend URL.

## License

Internal use — adapt as needed.
