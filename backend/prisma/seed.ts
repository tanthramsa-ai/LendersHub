/**
 * Seed script — creates the first SUPER_ADMIN user.
 * Uses the pg pool directly with RLS bypass so it works even with
 * FORCE ROW LEVEL SECURITY enabled on the users table.
 *
 * Usage:
 *   SUPER_ADMIN_EMAIL=admin@example.com \
 *   SUPER_ADMIN_PASSWORD=MyStr0ng!Pass \
 *   npx ts-node -r tsconfig-paths/register prisma/seed.ts
 *
 * Or via npm script: npm run seed
 */

import 'dotenv/config';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'admin@lendershub.in';
const PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? 'Admin@LH2024!';

async function seed() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Check your .env file.');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // Bypass RLS for this transaction so we can read/write the users table.
    await client.query("SELECT set_config('app.bypass_rls', 'true', TRUE)");

    const existing = await client.query(
      'SELECT id, email FROM users WHERE email = $1',
      [EMAIL],
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      console.log(`✓ Super admin already exists: ${EMAIL}`);
      return;
    }

    const hashed = await bcrypt.hash(PASSWORD, 10);

    await client.query(
      `INSERT INTO users (id, email, password, first_name, last_name, role, created_at, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, 'Super', 'Admin', 'SUPER_ADMIN', NOW(), NOW())`,
      [EMAIL, hashed],
    );

    await client.query('COMMIT');

    console.log('✓ Super admin created successfully');
    console.log(`  Email    : ${EMAIL}`);
    console.log(`  Password : ${PASSWORD}`);
    console.log('  ⚠  Change this password immediately after first login!');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('✗ Seed failed:', err.message);
  process.exit(1);
});
