import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { StatementRow } from './tenant-financial-ledger.service';
import { LOAN_TYPE_LABELS } from './statement-sql';

/**
 * Excel and PDF renderings of the statement. Both take already-fetched data, so what a user
 * downloads is exactly the rows and totals the screen shows for the same filters.
 */

export interface ExportCards {
  financialYear: string;
  totalCapital: number | null; fundAvailable: number | null;
  totalLent: number | null; lentInPeriod: number | null;
  outstandingPrincipal: number | null; outstandingInterest: number | null;
  interestCollected: number; principalRecovered: number; otherCollected: number;
  cashInHand: number | null; bankBalance: number | null;
}

export interface ExportBucket {
  key: string; label: string; disbursed: number; principal: number; interest: number; other: number;
  moneyIn: number; moneyOut: number; net: number;
}

export interface ExportData {
  company: string;
  title: string;
  fyLabel: string;
  range: { from: string; to: string };
  period: string;
  filtersText: string;
  generatedBy: string;
  generatedAt: Date;
  cards: ExportCards;
  buckets: ExportBucket[];
  openingBalance: number | null;
  closingBalance: number | null;
  totalCredit: number;
  totalDebit: number;
  showBalance: boolean;
  rows: StatementRow[];
}

const CARD_ROWS: [keyof ExportCards, string][] = [
  ['financialYear', 'Financial year'], ['totalCapital', 'Total capital'], ['fundAvailable', 'Fund available'],
  ['totalLent', 'Total money lent'], ['lentInPeriod', 'Lent in period'],
  ['outstandingPrincipal', 'Outstanding principal'], ['outstandingInterest', 'Outstanding interest'],
  ['interestCollected', 'Interest collected'], ['principalRecovered', 'Principal recovered'],
  ['cashInHand', 'Cash in hand'], ['bankBalance', 'Bank balance'],
];

/** The statement's visible columns, shared by both formats so they cannot drift apart. */
function columns(showBalance: boolean) {
  const cols = [
    { key: 'date', header: 'Date', width: 12 },
    { key: 'type', header: 'Transaction type', width: 24 },
    { key: 'loan', header: 'Loan', width: 15 },
    { key: 'customer', header: 'Customer', width: 22 },
    { key: 'agent', header: 'Agent', width: 18 },
    { key: 'branch', header: 'Branch', width: 14 },
    { key: 'debit', header: 'Debit (out)', width: 14 },
    { key: 'credit', header: 'Credit (in)', width: 14 },
  ];
  if (showBalance) cols.push({ key: 'balance', header: 'Running balance', width: 16 });
  cols.push(
    { key: 'mode', header: 'Mode', width: 12 },
    { key: 'remarks', header: 'Remarks', width: 34 },
    { key: 'by', header: 'Created by', width: 18 },
  );
  return cols;
}

const loanLabel = (r: StatementRow) => r.loanNumber ?? '';
const typeLabel = (r: StatementRow) => r.kindLabel + (r.loanType ? ` · ${LOAN_TYPE_LABELS[r.loanType] ?? r.loanType}` : '');
const modeLabel = (r: StatementRow) => (r.accountName ? `${r.mode} (${r.accountName})` : r.mode);

const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// ── Excel ────────────────────────────────────────────────────────────────────

export async function buildXlsx(d: ExportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LendersHub';
  wb.created = d.generatedAt;

  // Summary sheet
  const s = wb.addWorksheet('Summary');
  s.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  s.addRow([d.company]).font = { bold: true, size: 14 };
  s.addRow([d.title]).font = { bold: true, size: 12 };
  s.addRow([`${d.fyLabel} · ${d.range.from} to ${d.range.to}`]);
  if (d.filtersText) s.addRow([`Filters: ${d.filtersText}`]);
  s.addRow([`Generated ${d.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC by ${d.generatedBy}`]);
  s.addRow([]);
  for (const [key, label] of CARD_ROWS) {
    const v = d.cards[key];
    if (v === null || v === undefined) continue;
    const row = s.addRow([label, v]);
    row.getCell(1).font = { bold: true };
    if (typeof v === 'number') row.getCell(2).numFmt = '#,##0.00';
  }
  s.addRow([]);
  const head = s.addRow(['Period', 'Disbursed', 'Principal collected', 'Interest collected', 'Other collected', 'Money in', 'Money out', 'Net']);
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF5' } }; });
  for (const b of d.buckets) {
    const r = s.addRow([b.label, b.disbursed, b.principal, b.interest, b.other, b.moneyIn, b.moneyOut, b.net]);
    for (let c = 2; c <= 8; c++) r.getCell(c).numFmt = '#,##0.00';
  }

  // Statement sheet
  const t = wb.addWorksheet('Statement', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = columns(d.showBalance);
  t.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  t.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  t.getRow(1).eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C81' } }; });
  for (const r of d.rows) {
    const row = t.addRow({
      date: r.date, type: typeLabel(r), loan: loanLabel(r), customer: r.customerName ?? '', agent: r.agentName ?? '',
      branch: r.branchName ?? '', debit: r.debit ?? '', credit: r.credit ?? '', balance: r.runningBalance ?? '',
      mode: modeLabel(r), remarks: [r.remarks, r.referenceNo ? `Ref ${r.referenceNo}` : ''].filter(Boolean).join(' · '),
      by: r.createdByName ?? '',
    });
    if (r.debit !== null) { row.getCell('debit').font = { color: { argb: 'FFB91C1C' } }; row.getCell('debit').numFmt = '#,##0.00'; }
    if (r.credit !== null) { row.getCell('credit').font = { color: { argb: 'FF15803D' } }; row.getCell('credit').numFmt = '#,##0.00'; }
    if (d.showBalance) row.getCell('balance').numFmt = '#,##0.00';
  }
  const tot = t.addRow({ date: 'Total', debit: d.totalDebit, credit: d.totalCredit });
  tot.font = { bold: true };
  tot.getCell('debit').numFmt = '#,##0.00';
  tot.getCell('credit').numFmt = '#,##0.00';
  if (d.showBalance && d.openingBalance !== null && d.closingBalance !== null) {
    t.addRow({ date: 'Opening balance', balance: d.openingBalance }).font = { bold: true };
    t.addRow({ date: 'Closing balance', balance: d.closingBalance }).font = { bold: true };
    t.getCell(`I${t.rowCount - 1}`).numFmt = '#,##0.00';
    t.getCell(`I${t.rowCount}`).numFmt = '#,##0.00';
  }
  t.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PDF ──────────────────────────────────────────────────────────────────────

/** pdfkit's built-in fonts have no ₹ glyph, so the PDF writes "Rs." */
export function buildPdf(d: ExportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 14;

    doc.font('Helvetica-Bold').fontSize(14).fillColor('#0F4C81').text(d.company, left, doc.y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(d.title);
    doc.font('Helvetica').fontSize(8.5).fillColor('#4B5563')
      .text(`${d.fyLabel}  ·  ${d.range.from} to ${d.range.to}${d.filtersText ? `  ·  Filters: ${d.filtersText}` : ''}`);
    doc.text(`Generated ${d.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC by ${d.generatedBy}`);
    doc.moveDown(0.6);

    // Summary cards: label over value, in a wrapped row
    const cards = CARD_ROWS.filter(([k]) => d.cards[k] !== null && d.cards[k] !== undefined && k !== 'financialYear');
    const cw = 120, ch = 30, gap = 8;
    let x = left, y = doc.y;
    for (const [key, label] of cards) {
      if (x + cw > right) { x = left; y += ch + gap; }
      doc.roundedRect(x, y, cw, ch, 3).fillAndStroke('#F3F4F6', '#E5E7EB');
      doc.fillColor('#6B7280').font('Helvetica').fontSize(6.5).text(label.toUpperCase(), x + 6, y + 5, { width: cw - 12 });
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9.5).text(`Rs. ${inr(d.cards[key] as number)}`, x + 6, y + 15, { width: cw - 12 });
      x += cw + gap;
    }
    doc.y = y + ch + 12;

    // Table
    const cols = columns(d.showBalance).map((c) => ({ ...c }));
    const money = new Set(['debit', 'credit', 'balance']);
    const total = cols.reduce((s, c) => s + c.width, 0);
    const scale = (right - left) / total;
    const widths = cols.map((c) => c.width * scale);

    const header = () => {
      const top = doc.y;
      doc.rect(left, top, right - left, 16).fill('#0F4C81');
      let cx = left;
      cols.forEach((c, i) => {
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7)
          .text(c.header, cx + 3, top + 4.5, { width: widths[i] - 6, align: money.has(c.key) ? 'right' : 'left', lineBreak: false });
        cx += widths[i];
      });
      doc.y = top + 18;
    };
    header();

    let zebra = false;
    for (const r of d.rows) {
      const cells: Record<string, string> = {
        date: r.date, type: typeLabel(r), loan: loanLabel(r), customer: r.customerName ?? '', agent: r.agentName ?? '',
        branch: r.branchName ?? '', debit: r.debit !== null ? inr(r.debit) : '', credit: r.credit !== null ? inr(r.credit) : '',
        balance: r.runningBalance !== null ? inr(r.runningBalance) : '', mode: modeLabel(r),
        remarks: [r.remarks, r.referenceNo ? `Ref ${r.referenceNo}` : ''].filter(Boolean).join(' · '), by: r.createdByName ?? '',
      };
      doc.font('Helvetica').fontSize(6.8);
      const rowH = Math.max(11, ...cols.map((c, i) => doc.heightOfString(cells[c.key] ?? '', { width: widths[i] - 6 }) + 4));
      if (doc.y + rowH > bottom()) { doc.addPage(); header(); zebra = false; }
      const top = doc.y;
      if (zebra) doc.rect(left, top, right - left, rowH).fill('#F9FAFB');
      zebra = !zebra;
      let cx = left;
      cols.forEach((c, i) => {
        const color = c.key === 'debit' ? '#B91C1C' : c.key === 'credit' ? '#15803D' : '#111827';
        doc.fillColor(color).font('Helvetica').fontSize(6.8)
          .text(cells[c.key] ?? '', cx + 3, top + 2.5, { width: widths[i] - 6, align: money.has(c.key) ? 'right' : 'left' });
        cx += widths[i];
      });
      doc.y = top + rowH;
    }

    if (doc.y + 40 > bottom()) doc.addPage();
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111827');
    doc.text(`Total debit: Rs. ${inr(d.totalDebit)}     Total credit: Rs. ${inr(d.totalCredit)}     Rows: ${d.rows.length}`, left, doc.y);
    if (d.showBalance && d.openingBalance !== null && d.closingBalance !== null) {
      doc.text(`Opening balance: Rs. ${inr(d.openingBalance)}     Closing balance: Rs. ${inr(d.closingBalance)}`);
    }

    // Page numbers
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // The footer sits inside the bottom margin. pdfkit starts a new page for any text placed
      // below the margin, which produced blank trailing pages, so drop the margin for this write.
      const footerY = doc.page.height - doc.page.margins.bottom + 4;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7).fillColor('#9CA3AF')
        .text(`Page ${i + 1} of ${range.count}`, left, footerY, { width: right - left, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
