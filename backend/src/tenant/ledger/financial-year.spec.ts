import { BadRequestException } from '@nestjs/common';
import { availableFys, currentFy, fyLabel, fyMonths, fyOfDate, fyQuarters, fyRange, resolvePeriod } from './financial-year';

describe('financial year (April-March)', () => {
  it('names the FY by its starting year', () => {
    expect(fyLabel(2025)).toBe('FY 2025-26');
    expect(fyLabel(2099)).toBe('FY 2099-00');
    expect(fyLabel(2009)).toBe('FY 2009-10');
  });

  it.each([
    ['2026-03-31', 2025], ['2026-04-01', 2026], ['2025-04-01', 2025], ['2025-12-31', 2025], ['2026-01-01', 2025],
  ])('%s belongs to FY starting %p', (date, fy) => {
    expect(fyOfDate(date)).toBe(fy);
  });

  it('knows the current FY across the 1 April boundary', () => {
    expect(currentFy(new Date('2026-03-31T10:00:00Z'))).toBe(2025);
    expect(currentFy(new Date('2026-04-01T00:00:00Z'))).toBe(2026);
    expect(currentFy(new Date('2026-10-03T00:00:00Z'))).toBe(2026);
  });

  it('spans 1 April to 31 March', () => {
    expect(fyRange(2025)).toEqual({ from: '2025-04-01', to: '2026-03-31' });
  });

  it('has 12 months, April first, covering the year with no gaps or overlaps', () => {
    const months = fyMonths(2025);
    expect(months.map((m) => m.key)).toEqual(['2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03']);
    expect(months[0].from).toBe('2025-04-01');
    expect(months[11].to).toBe('2026-03-31');
    months.slice(1).forEach((m, i) => {
      const prevEnd = new Date(Date.parse(months[i].to) + 864e5).toISOString().slice(0, 10);
      expect(m.from).toBe(prevEnd);
    });
  });

  it('knows the length of February in a leap year', () => {
    expect(fyMonths(2023).find((m) => m.key === '2024-02')!.to).toBe('2024-02-29');
    expect(fyMonths(2024).find((m) => m.key === '2025-02')!.to).toBe('2025-02-28');
  });

  it('splits into Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar', () => {
    const q = fyQuarters(2025);
    expect(q.map((b) => [b.key, b.from, b.to])).toEqual([
      ['Q1', '2025-04-01', '2025-06-30'], ['Q2', '2025-07-01', '2025-09-30'],
      ['Q3', '2025-10-01', '2025-12-31'], ['Q4', '2026-01-01', '2026-03-31'],
    ]);
    expect(q[3].label).toBe('Q4 (Jan–Mar)');
  });
});

describe('resolvePeriod', () => {
  const today = new Date('2026-10-03T00:00:00Z');

  it('defaults to the current FY, monthly', () => {
    const p = resolvePeriod({}, today);
    expect(p).toMatchObject({ fy: 2026, fyLabel: 'FY 2026-27', period: 'monthly', range: { from: '2026-04-01', to: '2027-03-31' } });
    expect(p.buckets).toHaveLength(12);
  });

  it('quarterly gives four buckets over the whole FY', () => {
    const p = resolvePeriod({ fy: '2025', period: 'quarterly' }, today);
    expect(p.buckets.map((b) => b.key)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(p.range).toEqual({ from: '2025-04-01', to: '2026-03-31' });
  });

  it('custom takes the given range as one bucket', () => {
    const p = resolvePeriod({ period: 'custom', from: '2026-06-15', to: '2026-07-20' }, today);
    expect(p.range).toEqual({ from: '2026-06-15', to: '2026-07-20' });
    expect(p.buckets).toHaveLength(1);
  });

  it('custom with no dates falls back to the FY', () => {
    expect(resolvePeriod({ period: 'custom', fy: 2025 }, today).range).toEqual(fyRange(2025));
  });

  it.each([
    ['a non-numeric fy', { fy: 'abc' }], ['an fy out of range', { fy: 1999 }], ['a fractional fy', { fy: 2025.5 }],
    ['an unknown period', { period: 'weekly' }],
    ['an impossible from date', { period: 'custom', from: '2026-02-31', to: '2026-03-01' }],
    ['a malformed to date', { period: 'custom', from: '2026-01-01', to: 'tomorrow' }],
    ['from after to', { period: 'custom', from: '2026-05-01', to: '2026-04-01' }],
    ['a range over five years', { period: 'custom', from: '2015-01-01', to: '2026-01-01' }],
  ])('rejects %s with a 400', (_label, q) => {
    expect(() => resolvePeriod(q as never, today)).toThrow(BadRequestException);
  });
});

describe('availableFys', () => {
  const today = new Date('2026-10-03T00:00:00Z');
  it('lists every FY from the first transaction to now, newest first', () => {
    expect(availableFys('2024-08-10', today)).toEqual([2026, 2025, 2024]);
  });
  it('is just the current FY with no history', () => {
    expect(availableFys(null, today)).toEqual([2026]);
  });
  it('never lists a future FY for a future-dated first row', () => {
    expect(availableFys('2030-01-01', today)).toEqual([2026]);
  });
});
