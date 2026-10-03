import { BadRequestException } from '@nestjs/common';
import { isValidYmd } from '../../common/utils/dates';

/**
 * Indian financial year: 1 April to 31 March. `fy` is the calendar year it STARTS in, so
 * fy = 2025 is "FY 2025-26" (2025-04-01 .. 2026-03-31).
 */
export type PeriodType = 'monthly' | 'quarterly' | 'custom';

export interface DateRange { from: string; to: string }

export interface PeriodBucket extends DateRange {
  /** Stable key: 'YYYY-MM' for a month, 'Q1'..'Q4' for a quarter, 'custom' for a range. */
  key: string;
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

/** The FY (by start year) that contains the given YYYY-MM-DD date. */
export function fyOfDate(date: string): number {
  const [y, m] = date.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

export function currentFy(today = new Date()): number {
  return fyOfDate(today.toISOString().slice(0, 10));
}

export function fyLabel(fy: number): string {
  return `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

export function fyRange(fy: number): DateRange {
  return { from: ymd(fy, 4, 1), to: ymd(fy + 1, 3, 31) };
}

/** Months of a FY in order, April first. */
export function fyMonths(fy: number): PeriodBucket[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;             // 4,5,...,12,1,2,3
    const y = m >= 4 ? fy : fy + 1;
    return { key: `${y}-${pad(m)}`, label: `${MONTHS[m - 1]} ${y}`, from: ymd(y, m, 1), to: ymd(y, m, lastDay(y, m)) };
  });
}

/** Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar. */
export function fyQuarters(fy: number): PeriodBucket[] {
  const months = fyMonths(fy);
  return [0, 1, 2, 3].map((q) => ({
    key: `Q${q + 1}`,
    label: `Q${q + 1} (${MONTHS[(3 + q * 3) % 12]}–${MONTHS[(5 + q * 3) % 12]})`,
    from: months[q * 3].from,
    to: months[q * 3 + 2].to,
  }));
}

export interface StatementQuery {
  fy?: string | number;
  period?: string;
  from?: string;
  to?: string;
}

export interface ResolvedPeriod {
  fy: number;
  fyLabel: string;
  period: PeriodType;
  range: DateRange;
  buckets: PeriodBucket[];
}

/**
 * Turns the request's FY / period / date inputs into one concrete range plus the buckets to
 * break it into. Monthly and quarterly cover the whole selected FY; custom takes from/to
 * (defaulting to the FY) and is a single bucket. Anything malformed is a 400, not a 500.
 */
export function resolvePeriod(q: StatementQuery, today = new Date()): ResolvedPeriod {
  let fy = currentFy(today);
  if (q.fy !== undefined && q.fy !== null && q.fy !== '') {
    const n = Number(q.fy);
    if (!Number.isInteger(n) || n < 2000 || n > 2100) throw new BadRequestException('fy must be a year such as 2025 (for FY 2025-26)');
    fy = n;
  }
  const period = (q.period ?? 'monthly') as PeriodType;
  if (!['monthly', 'quarterly', 'custom'].includes(period)) {
    throw new BadRequestException('period must be monthly, quarterly or custom');
  }

  if (period === 'custom') {
    const base = fyRange(fy);
    const from = q.from || base.from;
    const to = q.to || base.to;
    if (!isValidYmd(from)) throw new BadRequestException('from must be a valid YYYY-MM-DD date');
    if (!isValidYmd(to)) throw new BadRequestException('to must be a valid YYYY-MM-DD date');
    if (from > to) throw new BadRequestException('from cannot be after to');
    const days = (Date.parse(to) - Date.parse(from)) / 864e5;
    if (days > 366 * 5) throw new BadRequestException('A custom range can span at most 5 years');
    return { fy, fyLabel: fyLabel(fy), period, range: { from, to }, buckets: [{ key: 'custom', label: `${from} to ${to}`, from, to }] };
  }

  return {
    fy, fyLabel: fyLabel(fy), period, range: fyRange(fy),
    buckets: period === 'monthly' ? fyMonths(fy) : fyQuarters(fy),
  };
}

/** FY start years that have data, newest first; always includes the current FY. */
export function availableFys(firstDate: string | null, today = new Date()): number[] {
  const last = currentFy(today);
  const first = firstDate && isValidYmd(firstDate) ? Math.min(fyOfDate(firstDate), last) : last;
  const out: number[] = [];
  for (let y = last; y >= first; y--) out.push(y);
  return out;
}
