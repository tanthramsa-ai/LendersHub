import { tenantSchemaDDL } from './tenant-schema';

describe('tenantSchemaDDL: money columns reject NaN', () => {
  const ddl = tenantSchemaDDL('tenant_acme');
  const constraints = ddl.filter((sql) => /ck_\w+_no_nan/.test(sql));

  it('covers every table that holds an amount', () => {
    const tables = constraints.map((sql) => /ALTER TABLE "?tenant_acme"?\."(\w+)"/.exec(sql)![1]).sort();
    expect(tables).toEqual([
      'fund_transactions', 'funder_transactions', 'incoming_payment_events', 'installments',
      'ledger_transactions', 'loan_funder_allocations', 'loans', 'payments',
    ]);
  });

  it('is safe to re-run on every boot: duplicate_object is swallowed, and existing rows are not rescanned', () => {
    for (const sql of constraints) {
      expect(sql).toContain('EXCEPTION WHEN duplicate_object THEN NULL');
      expect(sql).toContain('NOT VALID');
      expect(sql.trim().startsWith('DO $$')).toBe(true);
    }
  });

  it("checks each column against 'NaN' and no other column", () => {
    const payments = constraints.find((sql) => sql.includes('"payments"'))!;
    expect(payments).toContain("CHECK (amount <> 'NaN')");
    const ledger = constraints.find((sql) => sql.includes('"ledger_transactions"'))!;
    for (const col of ['principal_amount', 'interest_amount', 'fee_amount', 'other_amount', 'total_amount']) {
      expect(ledger).toContain(`${col} <> 'NaN'`);
    }
  });

  // A typo'd column would fail on every boot ("column does not exist") and keep the repair
  // fingerprint from ever being recorded, so each named column must really exist.
  it('only names columns that the table actually defines', () => {
    for (const sql of constraints) {
      const table = /ALTER TABLE "?tenant_acme"?\."(\w+)"/.exec(sql)![1];
      const columns = [...sql.matchAll(/(\w+) <> 'NaN'/g)].map((m) => m[1]);
      expect(columns.length).toBeGreaterThan(0);
      const defining = ddl.filter((s) => !s.includes('_no_nan') && new RegExp(`"${table}"`).test(s)).join('\n');
      for (const col of columns) {
        expect({ table, col, defined: new RegExp(`\\b${col}\\b`).test(defining) }).toEqual({ table, col, defined: true });
      }
    }
  });
});
