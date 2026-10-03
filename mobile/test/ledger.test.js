jest.mock('../src/api/client', () => ({ apiRequest: jest.fn() }));

const L = require('../src/utils/ledger');
const { apiRequest } = require('../src/api/client');
const api = require('../src/api/ledger');

describe('financial year', () => {
  it('starts in April', () => {
    expect(L.currentFy(new Date(2026, 3, 1))).toBe(2026);   // 1 Apr 2026
    expect(L.currentFy(new Date(2026, 2, 31))).toBe(2025);  // 31 Mar 2026
    expect(L.currentFy(new Date(2026, 11, 31))).toBe(2026);
    expect(L.currentFy(new Date(2027, 0, 1))).toBe(2026);
  });
  it('labels the year', () => {
    expect(L.fyLabel(2026)).toBe('FY 2026-27');
    expect(L.fyLabel(2099)).toBe('FY 2099-00');
  });
});

describe('buildQuery', () => {
  it('keeps only params with a value and encodes them', () => {
    expect(L.buildQuery({ fy: 2026, from: undefined, q: '', page: 0, search: 'a b&c' })).toBe('?fy=2026&page=0&search=a%20b%26c');
    expect(L.buildQuery({ a: undefined, b: null })).toBe('');
  });
});

describe('money formatting', () => {
  it('uses Indian grouping with paise', () => {
    expect(L.fmtMoney(115000)).toBe('₹1,15,000.00');
    expect(L.fmtMoney(0.5)).toBe('₹0.50');
    expect(L.fmtMoney(-2500)).toBe('-₹2,500.00');
  });
  it('shows a dash for a figure the role cannot see', () => {
    expect(L.fmtMoney(null)).toBe('—');
    expect(L.fmtMoney(undefined)).toBe('—');
    expect(L.fmtMoney(NaN)).toBe('—');
  });
  it('signs a row by what it moved', () => {
    expect(L.signedAmount({ debit: null, credit: 500 })).toEqual({ text: '+₹500.00', tone: 'in' });
    expect(L.signedAmount({ debit: 500, credit: null })).toEqual({ text: '−₹500.00', tone: 'out' });
    expect(L.signedAmount({ debit: null, credit: null }).tone).toBe('neutral');
  });
});

describe('kindMeta / groupByDate', () => {
  it('names known kinds and falls back for unknown ones', () => {
    expect(L.kindMeta('COLLECTION_INTEREST')).toEqual({ label: 'Interest collected', tone: 'in' });
    expect(L.kindMeta('SOMETHING_NEW')).toEqual({ label: 'SOMETHING_NEW', tone: 'neutral' });
  });
  it('groups consecutive rows by date', () => {
    const rows = [{ date: '2026-04-02', id: 1 }, { date: '2026-04-02', id: 2 }, { date: '2026-04-01', id: 3 }];
    const g = L.groupByDate(rows);
    expect(g.map((x) => [x.date, x.rows.length])).toEqual([['2026-04-02', 2], ['2026-04-01', 1]]);
    expect(L.groupByDate([])).toEqual([]);
  });
});

describe('role gates', () => {
  it('lets every field role see the ledger but only managers and up post entries', () => {
    for (const r of ['OWNER', 'ADMIN', 'MANAGER', 'AGENT']) expect(L.canViewLedger(r)).toBe(true);
    expect(L.canViewLedger('SOMEONE')).toBe(false);
    expect(L.canViewLedger(undefined)).toBe(false);
    expect(L.canPostEntry('MANAGER')).toBe(true);
    expect(L.canPostEntry('AGENT')).toBe(false);
    expect(L.seesBalances('ADMIN')).toBe(true);
    expect(L.seesBalances('MANAGER')).toBe(false);
  });
});

describe('validateQuickEntry', () => {
  const today = new Date('2026-09-28T10:00:00Z');
  const base = { type: 'CASH_IN', date: '2026-09-28', amount: '2500' };
  const err = (over) => { const r = L.validateQuickEntry({ ...base, ...over }, today); expect(r.ok).toBe(false); return r.error; };

  it('builds the request body', () => {
    expect(L.validateQuickEntry(base, today)).toEqual({ ok: true, body: { date: '2026-09-28', type: 'CASH_IN', amount: 2500 } });
    const r = L.validateQuickEntry({ type: 'BANK_OUT', date: '2026-09-27', amount: '10.5', accountName: ' HDFC ', referenceNo: 'R1', remarks: ' rent ' }, today);
    expect(r).toEqual({ ok: true, body: { date: '2026-09-27', type: 'BANK_OUT', amount: 10.5, accountName: 'HDFC', referenceNo: 'R1', remarks: 'rent' } });
  });
  it('ignores an account name on a cash entry', () => {
    expect(L.validateQuickEntry({ ...base, accountName: 'HDFC' }, today).body).not.toHaveProperty('accountName');
  });
  it('rejects bad amounts', () => {
    for (const a of ['', 'abc', '0', '0.00', '-5', '1,000', '12.345', '1e3', ' ', '1000000001']) expect(err({ amount: a })).toBeTruthy();
  });
  it('rejects bad or future dates', () => {
    expect(err({ date: '2026-02-30' })).toMatch(/valid date/);
    expect(err({ date: '28-09-2026' })).toMatch(/valid date/);
    expect(err({ date: '2026-10-05' })).toMatch(/future/);
    expect(L.validateQuickEntry({ ...base, date: '2026-09-29' }, today).ok).toBe(true); // one day of grace
  });
  it('rejects unknown types, CASH as a bank account, and over-long text', () => {
    expect(err({ type: 'TRANSFER' })).toMatch(/type/);
    expect(err({ type: 'BANK_IN', accountName: 'cash' })).toMatch(/CASH/);
    expect(err({ remarks: 'x'.repeat(501) })).toMatch(/Remarks/);
    expect(err({ referenceNo: 'x'.repeat(101) })).toMatch(/reference/);
    expect(err({ type: 'BANK_IN', accountName: 'x'.repeat(61) })).toMatch(/account name/);
  });
});

describe('ledger api', () => {
  beforeEach(() => { apiRequest.mockReset(); apiRequest.mockResolvedValue({}); });

  it('requests the summary for a year and period', async () => {
    await api.fetchLedgerSummary({ fy: 2026, period: 'quarterly', order: 'asc' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/tenant/financial-ledger/summary?fy=2026&period=quarterly');
  });
  it('requests a page of transactions with its filters', async () => {
    await api.fetchLedgerTransactions({ fy: 2026, period: 'custom', from: '2026-04-01', to: '2026-04-30', order: 'desc', page: 2, limit: 50 });
    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/tenant/financial-ledger/transactions?fy=2026&period=custom&from=2026-04-01&to=2026-04-30&order=desc&page=2&limit=50');
  });
  it('posts an entry as JSON', async () => {
    const body = { date: '2026-09-28', type: 'CASH_IN', amount: 100 };
    await api.createCashEntry(body);
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/tenant/financial-ledger/entries', { method: 'POST', body: JSON.stringify(body) });
  });
  it('builds the PDF path oldest-first', () => {
    expect(api.ledgerPdfPath({ fy: 2026, period: 'monthly' })).toBe('/api/v1/tenant/financial-ledger/export/pdf?fy=2026&period=monthly&order=asc');
  });
});
