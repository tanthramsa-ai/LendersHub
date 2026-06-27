/* eslint-disable */
/**
 * Create (or reset) a field-agent login for the mobile app.
 *
 * Inserts a COLLECTOR user into a tenant's schema with a bcrypt-hashed password,
 * exactly the way the app does it (bcrypt rounds=10, phone stored as given).
 *
 * Usage (run from the backend/ folder, deps installed):
 *   node scripts/create-agent.js                         # lists available tenants
 *   node scripts/create-agent.js <subdomain> <phone> [password] [role] [firstName] [lastName]
 *
 * Examples:
 *   node scripts/create-agent.js acme 9000000001
 *   node scripts/create-agent.js acme 9000000001 Agent@123 COLLECTOR Ravi Kumar
 *
 * DATABASE_URL is read from env, then backend/.env, then ../.env (root),
 * else defaults to the local Docker mapping (localhost:5433).
 */
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcrypt');

// Load env from backend/.env then root .env (without overriding real env vars).
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); } catch (_) {}
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') }); } catch (_) {}

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:devpass@localhost:5433/lendershub';

const [, , subdomainArg, phoneArg, passwordArg, roleArg, firstNameArg, lastNameArg] = process.argv;

const ROLE = (roleArg || 'COLLECTOR').toUpperCase();
const VALID_ROLES = ['ADMIN', 'LOAN_OFFICER', 'COLLECTOR', 'VIEWER'];

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  // No subdomain -> list tenants and exit.
  if (!subdomainArg) {
    const t = await client.query(
      `SELECT subdomain, schema_name, status FROM public.tenants ORDER BY created_at`,
    );
    if (t.rows.length === 0) {
      console.log('No tenants found. Create one first via the super-admin portal.');
    } else {
      console.log('Available tenants (use the subdomain):\n');
      for (const r of t.rows) {
        console.log(`  ${r.subdomain.padEnd(20)} schema=${r.schema_name}  status=${r.status}`);
      }
      console.log('\nThen: node scripts/create-agent.js <subdomain> <phone> [password]');
    }
    await client.end();
    return;
  }

  if (!phoneArg) throw new Error('Phone is required: node scripts/create-agent.js <subdomain> <phone> [password]');
  if (!VALID_ROLES.includes(ROLE)) throw new Error(`Invalid role "${ROLE}". One of: ${VALID_ROLES.join(', ')}`);

  const password = passwordArg || 'Agent@123';
  const firstName = firstNameArg || 'Field';
  const lastName = lastNameArg || 'Agent';
  const phone = String(phoneArg).replace(/[\s\-]/g, '');
  const email = `agent.${phone}@${subdomainArg}.local`;

  // Resolve tenant schema.
  const tRes = await client.query(
    `SELECT schema_name, status, company_name FROM public.tenants WHERE subdomain = $1 LIMIT 1`,
    [subdomainArg],
  );
  const tenant = tRes.rows[0];
  if (!tenant) throw new Error(`Tenant "${subdomainArg}" not found.`);
  if (!tenant.schema_name) throw new Error(`Tenant "${subdomainArg}" has no schema (still provisioning?).`);
  if (tenant.status !== 'ACTIVE') {
    console.warn(`WARNING: tenant status is "${tenant.status}" — login requires ACTIVE.`);
  }

  const hashed = await bcrypt.hash(password, 10);

  await client.query(`SET search_path = "${tenant.schema_name}", public`);

  // Upsert by phone OR email.
  const existing = await client.query(
    `SELECT id, email, phone FROM users WHERE phone = $1 OR LOWER(email) = LOWER($2) LIMIT 1`,
    [phone, email],
  );

  let action;
  if (existing.rows[0]) {
    await client.query(
      `UPDATE users
         SET password = $1, role = $2, phone = $3, first_name = $4, last_name = $5,
             is_active = TRUE, updated_at = NOW()
       WHERE id = $6`,
      [hashed, ROLE, phone, firstName, lastName, existing.rows[0].id],
    );
    action = 'updated existing user (password reset)';
  } else {
    await client.query(
      `INSERT INTO users (email, password, first_name, last_name, phone, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
      [email, hashed, firstName, lastName, phone, ROLE],
    );
    action = 'created new user';
  }

  await client.end();

  console.log('\n==========================================================');
  console.log(`  Agent login ready (${action})`);
  console.log('==========================================================');
  console.log(`  Organisation : ${tenant.company_name} (${subdomainArg})`);
  console.log(`  Role         : ${ROLE}`);
  console.log(`  Phone        : ${phone}`);
  console.log(`  Password     : ${password}`);
  console.log(`  Email        : ${email}`);
  console.log('----------------------------------------------------------');
  console.log('  Mobile app login:  enter Subdomain, Phone, Password.');
  console.log('  An OTP is then required. In local dev the SMS provider is');
  console.log('  "console", so the OTP is printed in the backend log:');
  console.log('      docker compose logs -f backend   (look for the OTP)');
  console.log('==========================================================\n');
}

main().catch((e) => {
  // Node throws an AggregateError (blank .message) when a localhost TCP connect
  // fails on both ::1 and 127.0.0.1 — surface the underlying cause.
  let msg = e && e.message;
  if ((!msg || msg === '') && e && Array.isArray(e.errors) && e.errors.length) {
    msg = e.errors.map((x) => x.message || String(x)).join('; ');
  }
  console.error('ERROR:', msg || e);
  if (/ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(String(msg))) {
    const url = (DATABASE_URL || '').replace(/:[^:@/]*@/, ':****@');
    console.error(`Could not reach the database at: ${url}`);
    console.error('Start it with:  docker compose up db -d   (from the repo root)');
  }
  process.exit(1);
});
