/**
 * Generates the next receipt number for a payment — requirements doc
 * §5.4 ("Receipt number" column), §7.3/§7.4 ("Return a receipt/reference").
 * Same convention as loan_number generation elsewhere in this codebase
 * (COUNT(*) + 1, zero-padded): sequential and human-readable, not strictly
 * concurrency-safe under truly simultaneous inserts, but that's the existing
 * codebase pattern this mirrors rather than a new one introduced here.
 */
export async function nextReceiptNumber(
  client: import('pg').PoolClient,
  schemaName: string,
): Promise<string> {
  await ensureReceiptNumberColumn(client, schemaName);
  const res = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM payments`);
  const seq = parseInt(res.rows[0].n) + 1;
  return `RCPT${new Date().getFullYear()}${String(seq).padStart(6, '0')}`;
}

/**
 * payments.receipt_number shipped with the ledger feature as an inline column
 * in tenantSchemaDDL()'s CREATE TABLE plus a matching ALTER — but that DDL
 * only ever runs at tenant provisioning, so every tenant created before the
 * ledger shipped is missing the column until someone re-runs it by hand.
 * Every code path that reads or writes a receipt number therefore ensures it
 * first: without this, recording a payment and the Collection/Daily Ledger
 * views all fail with an undefined_column 42703.
 *
 * Cached per schema per process, like the other lazy ensures in this codebase
 * (TenantActivityLogService, TenantLedgerPostingService). Safe inside a
 * caller's open transaction: ADD COLUMN IF NOT EXISTS never errors, so it can
 * not abort one.
 */
/**
 * Exported so tests can reset it: the cache is per-process and would
 * otherwise make a spec's expected query sequence depend on whether an
 * earlier test in the same file already warmed the same schema.
 */
export const receiptColumnEnsuredSchemas = new Set<string>();

export async function ensureReceiptNumberColumn(
  client: import('pg').PoolClient,
  schemaName: string,
): Promise<void> {
  if (receiptColumnEnsuredSchemas.has(schemaName)) return;
  await client.query(`ALTER TABLE "${schemaName}"."payments" ADD COLUMN IF NOT EXISTS receipt_number TEXT`);
  receiptColumnEnsuredSchemas.add(schemaName);
}
