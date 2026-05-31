// Apply database/01_schema.sql + 02_rls.sql + 03_seed.sql to Supabase.
//
// Two ways to authorize (in priority order):
//
//   1. SUPABASE_DB_URL   – full Postgres connection string from
//                          Supabase Dashboard → Project Settings → Database → Connection string
//                          (e.g. postgres://postgres.koldxkjvbifsszuhjrll:[PWD]@aws-0-…pooler.supabase.com:5432/postgres)
//
//   2. SUPABASE_ACCESS_TOKEN – Personal Access Token (sbp_…) from
//                              https://supabase.com/dashboard/account/tokens
//                              We use it against the Supabase Management API.
//
// Either approach applies the full schema in one command:  node src/scripts/applySchema.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Default applies the initial bootstrap files. Pass file names as argv to apply
// only specific migrations, e.g.  node src/scripts/applySchema.js 08_devices_and_locations.sql
const DEFAULT_FILES = ['01_schema.sql', '02_rls.sql', '03_seed.sql'];
const FILES = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;
const DB_DIR = path.resolve(__dirname, '../../../database');

function readAll() {
  return FILES.map(f => ({
    name: f,
    sql: fs.readFileSync(path.join(DB_DIR, f), 'utf8'),
  }));
}

async function applyViaPAT(pat, ref) {
  console.log(`[apply] using Personal Access Token against Management API for project ${ref}`);
  for (const file of readAll()) {
    process.stdout.write(`[apply] ${file.name} … `);
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: file.sql }),
    });
    if (!r.ok) {
      const text = await r.text();
      console.log('FAIL');
      console.error(`  ${r.status} ${text.slice(0, 300)}`);
      process.exit(1);
    }
    console.log('OK');
  }
}

async function applyViaDbUrl(url) {
  console.log('[apply] using direct Postgres connection');
  // Lazy-require pg so it's only needed for this path
  let pg;
  try { pg = require('pg'); } catch {
    console.error('[apply] `pg` package not installed. Run: npm install pg');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  for (const file of readAll()) {
    process.stdout.write(`[apply] ${file.name} … `);
    try {
      await client.query(file.sql);
      console.log('OK');
    } catch (e) {
      console.log('FAIL');
      console.error(`  ${e.message}`);
      await client.end();
      process.exit(1);
    }
  }
  await client.end();
}

async function main() {
  const pat = process.env.SUPABASE_ACCESS_TOKEN;
  const dbUrl = process.env.SUPABASE_DB_URL;
  const ref = (process.env.SUPABASE_URL || '').match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

  if (dbUrl) {
    await applyViaDbUrl(dbUrl);
  } else if (pat && ref) {
    await applyViaPAT(pat, ref);
  } else {
    console.error(`
[apply] ❌ Need ONE of these credentials in backend/.env:

  Option A — direct database connection (fastest, no extra signup):
    SUPABASE_DB_URL=postgres://postgres.koldxkjvbifsszuhjrll:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres

    Grab it from: Supabase Dashboard → Project Settings → Database → Connection string → "Transaction Pooler"
    (Replace <PASSWORD> with the database password you set when creating the project.)

  Option B — Supabase Personal Access Token:
    SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxx

    Generate at: https://supabase.com/dashboard/account/tokens
    (Click "Generate new token", paste it in.)

Once either is in place, re-run:
  node src/scripts/applySchema.js
`);
    process.exit(1);
  }

  console.log('\n[apply] ✅ schema applied successfully');
  console.log('[apply] now run: npm run seed:admin');
}

main().catch(e => { console.error(e); process.exit(1); });
