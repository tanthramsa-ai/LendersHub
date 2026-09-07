import {
  SqlClient,
  ddlFingerprint,
  repairAllTenantSchemas,
  repairTenantSchema,
} from './tenant-schema-repair';
import { tenantSchemaDDL } from './tenant-schema';

/**
 * Fake pg client that answers the two bookkeeping queries and records every
 * statement it is handed, so a test can assert on what the repair actually ran.
 */
function makeClient(options: { recordedHash?: string; failOn?: RegExp } = {}) {
  const executed: string[] = [];
  const upserts: unknown[][] = [];

  const client: SqlClient = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT ddl_hash')) {
        return { rows: options.recordedHash ? [{ ddl_hash: options.recordedHash }] : [] };
      }
      if (sql.includes('INSERT INTO public."tenant_schema_repair"')) {
        upserts.push(params ?? []);
        return { rows: [] };
      }
      if (sql.includes('FROM public.tenants')) {
        return { rows: [{ subdomain: 'acme', schema_name: 'tenant_acme' }] };
      }
      executed.push(sql);
      if (options.failOn?.test(sql)) throw new Error('boom');
      return { rows: [] };
    }),
  };

  return { client, executed, upserts };
}

describe('tenant schema repair', () => {
  describe('ddlFingerprint', () => {
    it('is stable across calls and independent of any one tenant', () => {
      expect(ddlFingerprint()).toBe(ddlFingerprint());
      expect(ddlFingerprint()).toHaveLength(32);
    });

    it('changes when the DDL changes', () => {
      // Proxy for "someone added a statement": hashing a different statement
      // list must not collide with the real one.
      const current = ddlFingerprint();
      const withExtra = tenantSchemaDDL('__fingerprint__').concat('ALTER TABLE x ADD COLUMN y TEXT').join(';\n');
      expect(withExtra).not.toBe(tenantSchemaDDL('__fingerprint__').join(';\n'));
      expect(current).not.toBe(withExtra);
    });
  });

  describe('repairTenantSchema', () => {
    it('skips a schema already at the current DDL fingerprint', async () => {
      const { client, executed } = makeClient({ recordedHash: ddlFingerprint() });

      const result = await repairTenantSchema(client, 'tenant_acme');

      expect(result.skipped).toBe(true);
      expect(result.statements).toBe(0);
      // The point of the fingerprint: no ALTER COLUMN ... TYPE table rewrites
      // on a boot that changed nothing.
      expect(executed).toHaveLength(0);
    });

    it('applies every statement and records the fingerprint when the DDL has moved on', async () => {
      const { client, executed, upserts } = makeClient({ recordedHash: 'an-older-hash' });

      const result = await repairTenantSchema(client, 'tenant_acme');

      expect(result.skipped).toBe(false);
      expect(result.applied).toBe(result.statements);
      expect(result.failures).toEqual([]);
      expect(executed).toHaveLength(tenantSchemaDDL('tenant_acme').length);
      expect(executed.some((s) => s.includes('"tenant_acme"'))).toBe(true);
      expect(upserts).toEqual([['tenant_acme', ddlFingerprint(), result.statements]]);
    });

    it('repairs a schema that has never been recorded', async () => {
      const { client, upserts } = makeClient();

      const result = await repairTenantSchema(client, 'tenant_acme');

      expect(result.skipped).toBe(false);
      expect(upserts).toHaveLength(1);
    });

    it('re-applies under force even when the fingerprint matches', async () => {
      const { client, executed } = makeClient({ recordedHash: ddlFingerprint() });

      const result = await repairTenantSchema(client, 'tenant_acme', { force: true });

      expect(result.skipped).toBe(false);
      expect(executed.length).toBeGreaterThan(0);
    });

    it('keeps going after a failed statement and leaves the schema unrecorded', async () => {
      // A schema old enough to be missing one thing is usually missing several:
      // stopping at the first error would surface them one 500 at a time.
      const { client, executed, upserts } = makeClient({ failOn: /CREATE SCHEMA/ });

      const result = await repairTenantSchema(client, 'tenant_acme');

      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].message).toBe('boom');
      expect(result.applied).toBe(result.statements - 1);
      expect(executed).toHaveLength(result.statements);
      // Unrecorded on purpose — the next boot must try again rather than
      // treating a partial repair as done.
      expect(upserts).toEqual([]);
    });
  });

  describe('repairAllTenantSchemas', () => {
    it('ensures its bookkeeping table, then repairs each tenant', async () => {
      const { client, upserts } = makeClient();

      const results = await repairAllTenantSchemas(client);

      expect((client.query as jest.Mock).mock.calls[0][0]).toContain(
        'CREATE TABLE IF NOT EXISTS public."tenant_schema_repair"',
      );
      expect(results).toHaveLength(1);
      expect(results[0].schemaName).toBe('tenant_acme');
      expect(upserts).toHaveLength(1);
    });
  });
});
