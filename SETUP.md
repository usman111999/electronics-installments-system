# Quick start

## 1. Apply DB schema (one time, manual)

Open Supabase SQL Editor for project `koldxkjvbifsszuhjrll` and run, in order:

1. `database/01_schema.sql`
2. `database/02_rls.sql`
3. `database/03_seed.sql`

## 2. Backend

```
cd backend
npm install
npm run seed:admin       # creates admin@eis.local / Admin@123456
npm run dev              # http://localhost:4000
```

## 3. Frontend

```
cd frontend
npm install
npm run dev              # http://localhost:5173
```

Sign in at http://localhost:5173 — admin email `admin@eis.local`, password `Admin@123456`.
