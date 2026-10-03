/**
 * Pure helpers for the Ledger screen: no React, no native modules, so they run under plain Jest.
 * The server (see backend/src/tenant/ledger/financial-year.ts) is the authority for financial-year
 * and period maths; these only label things and shape requests for display.
 */

export type StatementKind =
  | 'DISBURSEMENT' | 'COLLECTION_PRINCIPAL' | 'COLLECTION_INTEREST' | 'COLLECTION_OTHER' | 'REFUND' | 'FEE_INCOME'
  | 'CASH_IN' | 'CASH_OUT' | 'BANK_IN' | 'BANK_OUT' | 'TRANSFER' | 'ADJUSTMENT';

export type LedgerPeriod = 'monthly' | 'quarterly';

/** Indian financial year, April to March, named by the calendar year it starts in. */
export function currentFy(today: Date = new Date()): number {
  const m = today.getMonth() + 1; // local time: this is what the person looking at the phone calls "today"
  return m >= 4 ? today.getFullYear() : today.getFullYear() - 1;
}

export function fyLabel(fy: number): string {
  return `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

/** Query string from only the params that have a value (undefined, null and '' are dropped). */
export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const q: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    q.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return q.length ? `?${q.join('&')}` : '';
}

export interface KindMeta { label: string; tone: 'in' | 'out' | 'neutral' }

const KINDS: Record<StatementKind, KindMeta> = {
  DISBURSEMENT: { label: 'Disbursement', tone: 'out' },
  COLLECTION_PRINCIPAL: { label: 'Principal collected', tone: 'in' },
  COLLECTION_INTEREST: { label: 'Interest collected', tone: 'in' },
  COLLECTION_OTHER: { label: 'Fees collected', tone: 'in' },
  REFUND: { label: 'Refund', tone: 'out' },
  FEE_INCOME: { label: 'Fee income', tone: 'in' },
  CASH_IN: { label: 'Cash deposit', tone: 'in' },
  CASH_OUT: { label: 'Cash withdrawal', tone: 'out' },
  BANK_IN: { label: 'Bank deposit', tone: 'in' },
  BANK_OUT: { label: 'Bank withdrawal', tone: 'out' },
  TRANSFER: { label: 'Transfer', tone: 'neutral' },
  ADJUSTMENT: { label: 'Adjustment', tone: 'neutral' },
};

export function kindMeta(kind: string): KindMeta {
  return KINDS[kind as StatementKind] ?? { label: kind, tone: 'neutral' };
}

/** ₹ with paise and Indian digit grouping, e.g. ₹1,15,000.00. Negative amounts keep the sign in front. */
export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  return `${n < 0 ? '-' : ''}₹${abs}`;
}

export interface AmountRow { debit: number | null; credit: number | null }

/** What a row moved, as the list shows it: "+₹500.00" in, "−₹500.00" out, or nothing for a non-cash row. */
export function signedAmount(row: AmountRow): { text: string; tone: 'in' | 'out' | 'neutral' } {
  if (row.credit !== null && row.credit !== undefined) return { text: `+${fmtMoney(row.credit)}`, tone: 'in' };
  if (row.debit !== null && row.debit !== undefined) return { text: `−${fmtMoney(row.debit)}`, tone: 'out' };
  return { text: '—', tone: 'neutral' };
}

export interface Dated { date: string }
export interface DateSection<T extends Dated> { date: string; rows: T[] }

/** Groups consecutive rows that share a date (the list arrives already ordered by date). */
export function groupByDate<T extends Dated>(rows: T[]): DateSection<T>[] {
  const out: DateSection<T>[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.date === r.date) last.rows.push(r);
    else out.push({ date: r.date, rows: [r] });
  }
  return out;
}

// ── quick cash entry ─────────────────────────────────────────────────────────

export const ENTRY_TYPES = [
  { key: 'CASH_IN', label: 'Cash in' },
  { key: 'CASH_OUT', label: 'Cash out' },
  { key: 'BANK_IN', label: 'Bank in' },
  { key: 'BANK_OUT', label: 'Bank out' },
] as const;

export type QuickEntryType = (typeof ENTRY_TYPES)[number]['key'];

export interface QuickEntryInput {
  type: QuickEntryType;
  date: string;          // YYYY-MM-DD
  amount: string;        // as typed
  accountName?: string;  // bank types only
  referenceNo?: string;
  remarks?: string;
}

export interface QuickEntryBody {
  date: string; type: QuickEntryType; amount: number;
  accountName?: string; referenceNo?: string; remarks?: string;
}

const isYmd = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/**
 * Checks a quick entry before it is sent so the person gets an answer at once. The server checks
 * everything again; this only avoids a round trip for the obvious mistakes.
 */
export function validateQuickEntry(
  input: QuickEntryInput,
  today: Date = new Date(),
): { ok: true; body: QuickEntryBody } | { ok: false; error: string } {
  if (!ENTRY_TYPES.some((t) => t.key === input.type)) return { ok: false, error: 'Choose a type' };
  if (!isYmd(input.date)) return { ok: false, error: 'Enter a valid date' };
  const latest = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // a day of grace, as the server allows
  if (input.date > latest) return { ok: false, error: 'The date cannot be in the future' };

  const raw = input.amount.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { ok: false, error: 'Enter the amount as a number, e.g. 2500 or 2500.50' };
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'The amount must be more than zero' };
  if (amount > 1_000_000_000) return { ok: false, error: 'That amount is too large' };

  const remarks = (input.remarks ?? '').trim();
  const referenceNo = (input.referenceNo ?? '').trim();
  const accountName = (input.accountName ?? '').trim();
  if (remarks.length > 500) return { ok: false, error: 'Remarks are too long (maximum 500 characters)' };
  if (referenceNo.length > 100) return { ok: false, error: 'The reference is too long (maximum 100 characters)' };

  const isBank = input.type === 'BANK_IN' || input.type === 'BANK_OUT';
  if (isBank && accountName.toUpperCase() === 'CASH') return { ok: false, error: 'A bank entry cannot use the account name CASH' };
  if (accountName.length > 60) return { ok: false, error: 'The account name is too long (maximum 60 characters)' };

  return {
    ok: true,
    body: {
      date: input.date, type: input.type, amount,
      ...(isBank && accountName ? { accountName } : {}),
      ...(referenceNo ? { referenceNo } : {}),
      ...(remarks ? { remarks } : {}),
    },
  };
}

/** Roles that may open the Ledger tab on the phone; the server enforces the same scope. */
export function canViewLedger(role: string | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'MANAGER' || role === 'AGENT';
}

/** Roles that may record a cash/bank entry (agents only see their own collections). */
export function canPostEntry(role: string | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'MANAGER';
}

/** Owner and Admin also see capital, cash and bank balances and the running balance. */
export function seesBalances(role: string | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}
