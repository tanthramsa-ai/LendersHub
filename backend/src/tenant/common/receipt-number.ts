/**
 * Generates the next receipt number for a payment — requirements doc
 * §5.4 ("Receipt number" column), §7.3/§7.4 ("Return a receipt/reference").
 * Same convention as loan_number generation elsewhere in this codebase
 * (COUNT(*) + 1, zero-padded): sequential and human-readable, not strictly
 * concurrency-safe under truly simultaneous inserts, but that's the existing
 * codebase pattern this mirrors rather than a new one introduced here.
 */
export async function nextReceiptNumber(client: import('pg').PoolClient): Promise<string> {
  const res = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM payments`);
  const seq = parseInt(res.rows[0].n) + 1;
  return `RCPT${new Date().getFullYear()}${String(seq).padStart(6, '0')}`;
}
