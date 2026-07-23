// migrate.mjs — apply db/migrations/*.sql to the APP database (ours), in order.
// Reads connection config from .env. Splits on GO batches. Idempotent SQL.
// Never touches IFL's database.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sql from 'mssql';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'db', 'migrations');

// minimal .env loader (no dependency) --------------------------------------
function loadEnv() {
  try {
    const text = readFileSync(join(__dirname, '..', '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    console.warn('No .env found — relying on process environment.');
  }
}

async function main() {
  loadEnv();
  const config = {
    server: process.env.APP_DB_SERVER ?? '.\\SQLEXPRESS',
    database: process.env.APP_DB_NAME ?? 'sms',
    user: process.env.APP_DB_USER,
    password: process.env.APP_DB_PASSWORD,
    options: {
      encrypt: (process.env.APP_DB_ENCRYPT ?? 'true') === 'true',
      trustServerCertificate:
        (process.env.APP_DB_TRUST_SERVER_CERTIFICATE ?? 'true') === 'true',
    },
  };

  const pool = await sql.connect(config);
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const raw = readFileSync(join(migrationsDir, file), 'utf8');
    const batches = raw.split(/^\s*GO\s*$/im).filter((b) => b.trim());
    process.stdout.write(`Applying ${file} ... `);
    for (const batch of batches) await pool.request().batch(batch);
    console.log('ok');
  }

  await pool.close();
  console.log('All migrations applied.');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
