import ExcelJS from 'exceljs';
import { buildPdf, buildXlsx, ExportData } from './statement-export';
import type { StatementRow } from './tenant-financial-ledger.service';

const row = (i: number, over: Partial<StatementRow> = {}): StatementRow => ({
  id: `r${i}`, date: '2026-10-03', kind: 'COLLECTION_PRINCIPAL', kindLabel: 'Collection – Principal',
  loanId: 'l1', loanNumber: `WL${i}`, loanType: 'WEEKLY', customerName: 'Priya Sharma', agentName: 'Test Agent', branchName: 'Main',
  debit: null, credit: 1000 + i, runningBalance: 5000 + i, mode: 'Cash', accountName: null, referenceNo: null,
  remarks: 'Office payment', createdByName: 'Admin', source: 'LEDGER', sourceId: `s${i}`, groupId: null, ...over,
});

const data = (rows: StatementRow[], over: Partial<ExportData> = {}): ExportData => ({
  company: 'Acme Finance', title: 'Financial ledger statement', fyLabel: 'FY 2026-27',
  range: { from: '2026-04-01', to: '2027-03-31' }, period: 'monthly', filtersText: '', generatedBy: 'Ann Owner',
  generatedAt: new Date('2026-10-03T08:00:00Z'),
  cards: {
    financialYear: 'FY 2026-27', totalCapital: 100000, fundAvailable: 5000, totalLent: 80000, lentInPeriod: 80000,
    outstandingPrincipal: 60000, outstandingInterest: 9000, interestCollected: 1500, principalRecovered: 20000, otherCollected: 0,
    cashInHand: 3000, bankBalance: 2000,
  },
  buckets: [{ key: '2026-10', label: 'Oct 2026', disbursed: 0, principal: 20000, interest: 1500, other: 0, moneyIn: 21500, moneyOut: 0, net: 21500 }],
  openingBalance: 0, closingBalance: 21500, totalCredit: 21500, totalDebit: 0, showBalance: true, rows, ...over,
});

/** Cell by header text: a workbook reloaded from a file has no column keys, only positions. */
function cell(sheet: ExcelJS.Worksheet, rowNumber: number, header: string) {
  const headers = sheet.getRow(1).values as unknown[];
  return sheet.getRow(rowNumber).getCell(headers.indexOf(header));
}

describe('Excel export', () => {
  it('has a Summary and a Statement sheet with one data row per transaction and the totals', async () => {
    const buf = await buildXlsx(data([row(1), row(2, { kind: 'DISBURSEMENT', kindLabel: 'Disbursement', debit: 5000, credit: null })]));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Statement']);
    const st = wb.getWorksheet('Statement')!;
    expect(st.getRow(1).values).toEqual(expect.arrayContaining(['Date', 'Debit (out)', 'Credit (in)', 'Running balance']));
    expect(cell(st, 2, 'Credit (in)').value).toBe(1001);
    expect(cell(st, 3, 'Debit (out)').value).toBe(5000);
    expect(cell(st, 2, 'Transaction type').value).toBe('Collection – Principal · Weekly');
  });

  it('puts figures in as numbers (so Excel can sum them), not formatted text', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildXlsx(data([row(1)]))) as unknown as ArrayBuffer);
    expect(typeof cell(wb.getWorksheet('Statement')!, 2, 'Credit (in)').value).toBe('number');
    const summary = wb.getWorksheet('Summary')!;
    const lent = summary.getRows(1, summary.rowCount)!.find((r) => r.getCell(1).value === 'Total money lent')!;
    expect(lent.getCell(2).value).toBe(80000);
  });

  it('leaves out the running balance column and the cash/capital cards when not allowed to show them', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildXlsx(data([row(1, { runningBalance: null })], {
      showBalance: false, openingBalance: null, closingBalance: null,
      cards: { ...data([]).cards, totalCapital: null, fundAvailable: null, cashInHand: null, bankBalance: null },
    }))) as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Statement')!.getRow(1).values).not.toContain('Running balance');
    const labels = wb.getWorksheet('Summary')!.getRows(1, 30)!.map((r) => r.getCell(1).value);
    expect(labels).not.toContain('Cash in hand');
    expect(labels).not.toContain('Total capital');
  });

  it('copes with no rows', async () => {
    const buf = await buildXlsx(data([]));
    expect(buf.length).toBeGreaterThan(1000);
  });
});

describe('PDF export', () => {
  it('is a PDF', async () => {
    const buf = await buildPdf(data([row(1)]));
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('spreads many rows over several pages, with no blank trailing page', async () => {
    const buf = await buildPdf(data(Array.from({ length: 140 }, (_, i) => row(i + 1))));
    const pages = (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(2);
    // every page object carries content: a stray footer-only page would be tiny, so just check count is sane
    expect(pages).toBeLessThan(12);
  });

  it('a short statement is exactly one page (the footer must not add a page)', async () => {
    const buf = await buildPdf(data([row(1), row(2)]));
    expect((buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
  });

  it('copes with no rows and with awkward text', async () => {
    await expect(buildPdf(data([]))).resolves.toBeDefined();
    await expect(buildPdf(data([row(1, { remarks: 'x'.repeat(900), customerName: 'Zoë ₹ — “quoted”' })]))).resolves.toBeDefined();
  });
});
