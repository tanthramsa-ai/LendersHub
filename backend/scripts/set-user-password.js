/* eslint-disable */
/**
 * Set (or reset) a tenant user's password from the command line.
 *
 * Tenant login no longer accepts users who have no stored password (it used to accept
 * ANY password for them), so a hand-built or restored user row with a NULL password has
 * to be given one here. Hashes it exactly the way the app does (bcrypt, 10 rounds) and
 * applies the same rules as the app: 8-72 bytes, at least one letter and one number.
 *
 * Usage (from backend/):
 *   node scripts/set-user-password.js <subdomain> <email-or-phone> <new-password>
 *
 * Example:
 *   node scripts/set-user-password.js axis owner@axis.local 'Axis@Local123'
 */
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const { resolveDatabaseUrl } = require('./db-url');

const [, , subdomain, identifier, password] = process.argv;

function problemWith(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'must be at least 8 characters';
  if (Buffer.byteLength(pw, 'utf8') > 72) return 'must be at most 72 bytes (bcrypt limit)';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'must contain at least one letter and one number';
  return null;
}

async function main() {
  if (!subdomain || !identifier || !password) {
    console.error('Usage: node scripts/set-user-password.js <subdomain> <email-or-phone> <new-password>');
    process.exit(1);
  }
  const problem = problemWith(password);
  if (problem) {
    console.error(`Password ${problem}.`);
    process.exit(1);
  }

  const client = new Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();
  try {
    const t = await client.query('SELECT schema_name FROM public.tenants WHERE subdomain = $1', [subdomain]);
    if (!t.rows[0]) {
      console.error(`No tenant with subdomain "${subdomain}".`);
      process.exit(1);
    }
    const schema = t.rows[0].schema_name;
    if (!/^[a-z0-9_]+$/.test(schema)) throw new Error(`Unexpected schema name: ${schema}`);

    const hashed = await bcrypt.hash(password, 10);
    const res = await client.query(
      `UPDATE "${schema}".users SET password = $1, updated_at = NOW()
        WHERE LOWER(email) = LOWER($2) OR phone = $2
        RETURNING email, role`,
      [hashed, identifier],
    );
    if (res.rowCount === 0) {
      console.error(`No user "${identifier}" in ${subdomain}.`);
      process.exit(1);
    }
    for (const r of res.rows) console.log(`Password set for ${r.email} (${r.role}) in ${subdomain}.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
