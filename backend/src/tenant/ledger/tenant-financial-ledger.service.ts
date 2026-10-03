import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { TenantFundersService } from '../funders/tenant-funders.service';
import { TenantLedgerPostingService } from './tenant-ledger-posting.service';
import { LEDGER_ROLES, MANAGER_ROLES, UserRole } from '../common/roles';
import { parseMoneyAmount } from '../../common/utils/money';
import { isValidYmd } from '../../common/utils/dates';
import { availableFys, PeriodBucket, resolvePeriod, ResolvedPeriod, StatementQuery } from './financial-year';
import { buildPdf, buildXlsx, ExportData } from './statement-export';
import {
  COLLECTION_KINDS, KIND_GROUPS, KIND_LABELS, LOAN_TYPE_LABELS, OUTSTANDING_INTEREST_SQL, OUTSTANDING_PRINCIPAL_LIVE_SQL,
  ROWS_CTE, STATEMENT_KINDS, StatementKind,
} from './statement-sql';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES = ['Cash', 'Bank', 'UPI', 'Other'];
export const EXPORT_ROW_CAP = 20000;


/**
 * What a caller may see, by role:
 *  - full:    Owner / Admin: everything, including capital, cash/bank balances and manual entries.
 *  - manager: loan money (disbursements, collections, refunds, fees) plus the manual cash/bank
 *             entries they recorded themselves, so they can see what they posted. No capital, cash/bank
 *             balances, anyone else's entries or running balance.
 *  - agent:   only their own collections.
 * Staff and Customer have no ledger access.
 */
export interface StatementScope { level: 'full' | 'manager' | 'agent'; userId: string }

export interface StatementFilters {
  kinds?: StatementKind[];
  mode?: string;
  agentId?: string;
  branchId?: string;
  loanId?: string;
  customerId?: string;
  q?: string;
}

export interface StatementRow {
  id: string; date: string; kind: StatementKind; kindLabel: string;
  loanId: string | null; loanNumber: string | null; loanType: string | null;
  customerName: string | null; agentName: string | null; branchName: string | null;
  debit: number | null; credit: number | null; runningBalance: number | null;
  mode: string; accountName: string | null; referenceNo: string | null; remarks: string | null;
  createdByName: string | null; source: 'LEDGER' | 'MANUAL'; sourceId: string; groupId: string | null;
}

export interface CreateEntryDto {
  date: string;
  type: 'CASH_IN' | 'CASH_OUT' | 'BANK_IN' | 'BANK_OUT' | 'TRANSFER' | 'ADJUSTMENT';
  amount: number;
  /** Bank account name for BANK_* and ADJUSTMENT; CASH is implied for CASH_*. */
  accountName?: string;
  /** TRANSFER only. 'CASH' or a bank account name. */
  fromAccount?: string;
  toAccount?: string;
  /** ADJUSTMENT only. */
  direction?: 'IN' | 'OUT';
  referenceNo?: string;
  remarks?: string;
}

/** Collects bind parameters so every query is built with numbered placeholders, never string-spliced. */
class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Posted remarks embed full ids ("installment 4b5cc5ce-708c-…"); the statement shows the first 8 characters. */
export const tidyRemarks = (s: string | null): string | null => (s ? s.replace(UUID_IN_TEXT, (m) => m.slice(0, 8)) : s);

const num = (v: unknown) => (v === null || v === undefined ? 0 : parseFloat(String(v)));
const round2 = (n: number) => Math.round(n * 100) / 100;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class TenantFinancialLedgerService {
  /** Schemas whose fund_transactions already has the soft-delete columns (avoids an ALTER per request). */
  private readonly softDeleteReady = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private ledgerPosting: TenantLedgerPostingService,
    private funders: TenantFundersService,
    private activity: TenantActivityLogService,
  ) {}

  // ── access ────────────────────────────────────────────────────────────────

  scopeFor(user: TenantJwtPayload): StatementScope {
    if (LEDGER_ROLES.includes(user.role as UserRole)) return { level: 'full', userId: user.sub };
    if (user.role === 'MANAGER') return { level: 'manager', userId: user.sub };
    if (user.role === 'AGENT') return { level: 'agent', userId: user.sub };
    throw new ForbiddenException('You do not have access to the ledger');
  }

  private scopeSql(scope: StatementScope, p: Params): string {
    if (scope.level === 'full') return '';
    if (scope.level === 'manager') return `WHERE (r.source = 'LEDGER' OR r.created_by = ${p.add(scope.userId)}::uuid)`;
    const kinds = COLLECTION_KINDS.map((k) => `'${k}'`).join(',');
    return `WHERE r.source = 'LEDGER' AND r.kind IN (${kinds}) AND r.agent_id = ${p.add(scope.userId)}::uuid`;
  }

  private async withSchema<T>(user: TenantJwtPayload, fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${user.schemaName}", public`);
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      await this.ensureSoftDelete(client, user.schemaName);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /** Older tenants predate fund_transactions.deleted_at; the boot repair adds it, this covers the gap. */
  private async ensureSoftDelete(client: import('pg').PoolClient, schemaName: string) {
    if (this.softDeleteReady.has(schemaName)) return;
    await client.query(`ALTER TABLE fund_transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE fund_transactions ADD COLUMN IF NOT EXISTS deleted_by UUID`);
    this.softDeleteReady.add(schemaName);
  }

  // ── input parsing ─────────────────────────────────────────────────────────

  parseFilters(raw: Record<string, unknown>, scope: StatementScope): StatementFilters {
    const f: StatementFilters = {};
    const uuid = (v: unknown, label: string): string | undefined => {
      if (v === undefined || v === null || v === '') return undefined;
      if (typeof v !== 'string' || !UUID_RE.test(v)) throw new BadRequestException(`${label} must be a valid id`);
      return v;
    };

    let kinds: StatementKind[] | undefined;
    if (raw.group !== undefined && raw.group !== '') {
      const g = KIND_GROUPS[String(raw.group)];
      if (!g) throw new BadRequestException(`group must be one of: ${Object.keys(KIND_GROUPS).join(', ')}`);
      kinds = g;
    }
    if (raw.kind !== undefined && raw.kind !== '') {
      const list = String(raw.kind).split(',').map((s) => s.trim()).filter(Boolean);
      const bad = list.filter((k) => !(STATEMENT_KINDS as readonly string[]).includes(k));
      if (bad.length) throw new BadRequestException(`Unknown transaction type: ${bad.join(', ')}`);
      kinds = kinds ? kinds.filter((k) => list.includes(k)) : (list as StatementKind[]);
    }
    if (kinds) f.kinds = kinds;

    if (raw.mode !== undefined && raw.mode !== '') {
      if (!MODES.includes(String(raw.mode))) throw new BadRequestException(`mode must be one of: ${MODES.join(', ')}`);
      f.mode = String(raw.mode);
    }
    f.branchId = uuid(raw.branchId, 'branchId');
    f.loanId = uuid(raw.loanId, 'loanId');
    f.customerId = uuid(raw.customerId, 'customerId');
    // An agent only ever sees their own rows; a requested agent filter must not widen that.
    f.agentId = scope.level === 'agent' ? undefined : uuid(raw.agentId, 'agentId');
    if (raw.q !== undefined && raw.q !== '') {
      const q = String(raw.q).trim();
      if (q.length > 100) throw new BadRequestException('Search text is too long');
      if (q) f.q = q;
    }
    return f;
  }

  private filterSql(f: StatementFilters, p: Params): string {
    const c: string[] = [];
    if (f.kinds) c.push(`kind = ANY(${p.add(f.kinds)}::text[])`);
    if (f.mode) c.push(`mode = ${p.add(f.mode)}`);
    if (f.agentId) c.push(`agent_id = ${p.add(f.agentId)}::uuid`);
    if (f.branchId) c.push(`branch_id = ${p.add(f.branchId)}::uuid`);
    if (f.loanId) c.push(`loan_id = ${p.add(f.loanId)}::uuid`);
    if (f.customerId) c.push(`customer_id = ${p.add(f.customerId)}::uuid`);
    if (f.q) {
      const like = p.add(`%${escapeLike(f.q)}%`);
      c.push(`(loan_number ILIKE ${like} OR customer_name ILIKE ${like} OR agent_name ILIKE ${like} OR remarks ILIKE ${like} OR reference_no ILIKE ${like})`);
    }
    return c.join(' AND ');
  }

  private paging(raw: Record<string, unknown>, maxLimit: number) {
    const page = raw.page === undefined ? 1 : Number(raw.page);
    const limit = raw.limit === undefined ? 50 : Number(raw.limit);
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page must be a positive whole number');
    if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) throw new BadRequestException(`limit must be between 1 and ${maxLimit}`);
    return { page, limit };
  }

  private baseCte(scope: StatementScope, p: Params): string {
    return `WITH ${ROWS_CTE}, scoped AS (SELECT * FROM stmt_rows r ${this.scopeSql(scope, p)})`;
  }

  private mapRow(r: Record<string, unknown>, showBalance: boolean): StatementRow {
    const amount = num(r.amount);
    const dir = Number(r.dir);
    return {
      id: r.id as string,
      date: r.date_ymd as string,
      kind: r.kind as StatementKind,
      kindLabel: KIND_LABELS[r.kind as StatementKind] ?? String(r.kind),
      loanId: (r.loan_id as string) ?? null,
      loanNumber: (r.loan_number as string) ?? null,
      loanType: (r.loan_type as string) ?? null,
      customerName: (r.customer_name as string) ?? null,
      agentName: (r.agent_name as string) ?? null,
      branchName: (r.branch_name as string) ?? null,
      debit: dir === -1 ? amount : null,
      credit: dir === 1 ? amount : null,
      runningBalance: showBalance ? round2(num(r.running)) : null,
      mode: r.mode as string,
      accountName: (r.account_name as string) ?? null,
      referenceNo: (r.reference_no as string) ?? null,
      remarks: tidyRemarks((r.remarks as string) ?? null),
      createdByName: (r.created_by_name as string) ?? null,
      source: r.source as 'LEDGER' | 'MANUAL',
      sourceId: r.source_id as string,
      groupId: (r.group_id as string) ?? null,
    };
  }

  // ── transactions grid ─────────────────────────────────────────────────────

  async transactions(user: TenantJwtPayload, query: Record<string, unknown>) {
    const scope = this.scopeFor(user);
    const period = resolvePeriod(query as StatementQuery);
    const filters = this.parseFilters(query, scope);
    const { page, limit } = this.paging(query, 200);
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    return this.withSchema(user, (client) => this.transactionsWith(client, scope, period, filters, { page, limit, order }));
  }

  private async transactionsWith(
    client: import('pg').PoolClient, scope: StatementScope, period: ResolvedPeriod, filters: StatementFilters,
    opts: { page: number; limit: number; order: 'ASC' | 'DESC' },
  ) {
    const showBalance = scope.level === 'full';
    const { range } = period;

    // The page of rows. Running balance is computed over the whole scoped history (not just the
    // filtered/paged rows), so it is the true balance at that row whatever the filters are.
    const p = new Params();
    const cte = this.baseCte(scope, p);
    const from = p.add(range.from), to = p.add(range.to);
    const filt = this.filterSql(filters, p);
    const lim = p.add(opts.limit), off = p.add((opts.page - 1) * opts.limit);
    const dir = opts.order;
    const rowsRes = await client.query(
      `${cte},
       ranked AS (
         SELECT s.*, SUM(s.amount * s.dir) OVER (ORDER BY s.txn_date, s.created_at, s.id) AS running FROM scoped s
       )
       SELECT ranked.*, to_char(txn_date, 'YYYY-MM-DD') AS date_ymd
         FROM ranked
        WHERE txn_date BETWEEN ${from}::date AND ${to}::date ${filt ? `AND ${filt}` : ''}
        ORDER BY txn_date ${dir}, created_at ${dir}, id ${dir}
        LIMIT ${lim} OFFSET ${off}`,
      p.values,
    );

    // Opening / closing ignore the type/mode/search filters (they are the period's balances);
    // the filtered totals respect them (they describe the rows being looked at).
    const t = new Params();
    const tcte = this.baseCte(scope, t);
    const tfrom = t.add(range.from), tto = t.add(range.to);
    const tfilt = this.filterSql(filters, t);
    const inRange = `txn_date BETWEEN ${tfrom}::date AND ${tto}::date`;
    const match = tfilt ? `${inRange} AND ${tfilt}` : inRange;
    const totalsRes = await client.query(
      `${tcte}
       SELECT COALESCE(SUM(amount * dir) FILTER (WHERE txn_date < ${tfrom}::date), 0) AS opening,
              COALESCE(SUM(amount * dir) FILTER (WHERE txn_date <= ${tto}::date), 0) AS closing,
              COALESCE(SUM(amount) FILTER (WHERE ${match} AND dir = 1), 0)  AS credit,
              COALESCE(SUM(amount) FILTER (WHERE ${match} AND dir = -1), 0) AS debit,
              COUNT(*) FILTER (WHERE ${match}) AS n
         FROM scoped`,
      t.values,
    );
    const tr = totalsRes.rows[0];
    const total = parseInt(tr.n, 10);

    return {
      fy: period.fy, fyLabel: period.fyLabel, period: period.period, range,
      openingBalance: showBalance ? round2(num(tr.opening)) : null,
      closingBalance: showBalance ? round2(num(tr.closing)) : null,
      totalCredit: round2(num(tr.credit)),
      totalDebit: round2(num(tr.debit)),
      rows: rowsRes.rows.map((r) => this.mapRow(r, showBalance)),
      total, page: opts.page, limit: opts.limit,
    };
  }

  /** Every row of the range, oldest first, for Excel/PDF. Refuses to build a huge file. */
  async exportData(user: TenantJwtPayload, query: Record<string, unknown>) {
    const scope = this.scopeFor(user);
    const period = resolvePeriod(query as StatementQuery);
    const filters = this.parseFilters(query, scope);
    const out = await this.withSchema(user, async (client) => {
      const first = await this.transactionsWith(client, scope, period, filters, { page: 1, limit: 1, order: 'ASC' });
      if (first.total > EXPORT_ROW_CAP) {
        throw new BadRequestException(`That range has ${first.total} rows; narrow it to at most ${EXPORT_ROW_CAP} to export`);
      }
      const all = await this.transactionsWith(client, scope, period, filters, { page: 1, limit: Math.max(first.total, 1), order: 'ASC' });
      const summary = await this.summaryWith(client, user, scope, period);
      return { all, summary };
    });
    return { scope, period, filters, ...out };
  }

  /** A ready-to-send Excel or PDF file of the same rows and totals the screen shows for these filters. */
  async exportFile(user: TenantJwtPayload, query: Record<string, unknown>, format: 'xlsx' | 'pdf') {
    const { scope, period, filters, all, summary } = await this.exportData(user, query);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { companyName: true } });
    const filterBits: string[] = [];
    if (filters.kinds) filterBits.push(`type ${filters.kinds.map((k) => KIND_LABELS[k]).join(', ')}`);
    if (filters.mode) filterBits.push(`mode ${filters.mode}`);
    if (filters.q) filterBits.push(`search "${filters.q}"`);
    if (filters.agentId) filterBits.push('one agent');
    if (filters.branchId) filterBits.push('one branch');
    if (filters.loanId) filterBits.push('one loan');
    const data: ExportData = {
      company: tenant?.companyName ?? user.subdomain,
      title: scope.level === 'agent' ? 'My collections statement' : 'Financial ledger statement',
      fyLabel: period.fyLabel, range: period.range, period: period.period,
      filtersText: filterBits.join('; '),
      generatedBy: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email,
      generatedAt: new Date(),
      cards: summary.cards, buckets: summary.buckets,
      openingBalance: all.openingBalance, closingBalance: all.closingBalance,
      totalCredit: all.totalCredit, totalDebit: all.totalDebit,
      showBalance: scope.level === 'full', rows: all.rows,
    };
    const buffer = format === 'xlsx' ? await buildXlsx(data) : await buildPdf(data);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `ledger-statement_${period.fyLabel.replace(/\s+/g, '')}_${period.period}_${stamp}`;
    return {
      buffer,
      filename: `${base}.${format}`,
      contentType: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
    };
  }

  // ── summary ───────────────────────────────────────────────────────────────

  async summary(user: TenantJwtPayload, query: Record<string, unknown>) {
    const scope = this.scopeFor(user);
    const period = resolvePeriod(query as StatementQuery);
    return this.withSchema(user, (client) => this.summaryWith(client, user, scope, period));
  }

  private async summaryWith(client: import('pg').PoolClient, user: TenantJwtPayload, scope: StatementScope, period: ResolvedPeriod) {
    const { range } = period;

    // Per-month sums over the range; buckets (months / quarters / the custom range) are folded from these.
    const m = new Params();
    const mcte = this.baseCte(scope, m);
    const mfrom = m.add(range.from), mto = m.add(range.to);
    const monthly = await client.query(
      `${mcte}
       SELECT to_char(txn_date, 'YYYY-MM') AS m,
              COALESCE(SUM(amount) FILTER (WHERE kind = 'DISBURSEMENT'), 0)          AS disbursed,
              COALESCE(SUM(amount) FILTER (WHERE kind = 'COLLECTION_PRINCIPAL'), 0)  AS principal,
              COALESCE(SUM(amount) FILTER (WHERE kind = 'COLLECTION_INTEREST'), 0)   AS interest,
              COALESCE(SUM(amount) FILTER (WHERE kind = 'COLLECTION_OTHER'), 0)      AS other,
              COALESCE(SUM(amount) FILTER (WHERE dir = 1), 0)                        AS money_in,
              COALESCE(SUM(amount) FILTER (WHERE dir = -1), 0)                       AS money_out,
              COUNT(*) FILTER (WHERE kind IN ('COLLECTION_PRINCIPAL','COLLECTION_INTEREST','COLLECTION_OTHER')) AS collections
         FROM scoped
        WHERE txn_date BETWEEN ${mfrom}::date AND ${mto}::date
        GROUP BY 1 ORDER BY 1`,
      m.values,
    );

    const buckets = period.buckets.map((b) => this.foldBucket(b, period.period === 'custom', monthly.rows));
    const sum = (key: 'disbursed' | 'principal' | 'interest' | 'other' | 'collections') => buckets.reduce((s, b) => s + b[key], 0);

    const l = new Params();
    const lcte = this.baseCte(scope, l);
    const life = await client.query(
      `${lcte}
       SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'DISBURSEMENT'), 0)            AS lent,
              COALESCE(SUM(amount * dir) FILTER (WHERE is_cash), 0)                     AS cash,
              COALESCE(SUM(amount * dir) FILTER (WHERE NOT is_cash), 0)                 AS bank,
              COALESCE(SUM(amount * dir) FILTER (WHERE source = 'LEDGER'), 0)           AS ledger_movement,
              to_char(MIN(txn_date), 'YYYY-MM-DD')                                      AS first_date
         FROM scoped`,
      l.values,
    );
    const lf = life.rows[0];

    const full = scope.level === 'full';
    const loanLevel = scope.level !== 'agent';
    let totalCapital: number | null = null;
    let fundAvailable: number | null = null;
    if (full) {
      totalCapital = await this.funders.getTotalCapitalWithClient(client, user.schemaName);
      fundAvailable = round2(totalCapital + num(lf.ledger_movement));
    }
    const outstandingPrincipal = loanLevel ? round2(num((await client.query(OUTSTANDING_PRINCIPAL_LIVE_SQL)).rows[0].outstanding)) : null;
    const outstandingInterest = loanLevel ? round2(num((await client.query(OUTSTANDING_INTEREST_SQL)).rows[0].outstanding)) : null;

    return {
      fy: period.fy,
      fyLabel: period.fyLabel,
      period: period.period,
      range,
      availableFys: availableFys(lf.first_date ?? null),
      scope: scope.level,
      cards: {
        financialYear: period.fyLabel,
        totalCapital,
        fundAvailable,
        totalLent: loanLevel ? round2(num(lf.lent)) : null,
        lentInPeriod: loanLevel ? round2(sum('disbursed')) : null,
        outstandingPrincipal,
        outstandingInterest,
        interestCollected: round2(sum('interest')),
        principalRecovered: round2(sum('principal')),
        otherCollected: round2(sum('other')),
        collectionsCount: sum('collections'),
        cashInHand: full ? round2(num(lf.cash)) : null,
        bankBalance: full ? round2(num(lf.bank)) : null,
      },
      buckets,
    };
  }

  private foldBucket(b: PeriodBucket, isCustom: boolean, months: Record<string, unknown>[]) {
    const mine = months.filter((r) => {
      if (isCustom) return true;
      const first = `${r.m}-01`;
      return first >= b.from && first <= b.to;
    });
    const add = (k: string) => round2(mine.reduce((s, r) => s + num(r[k]), 0));
    const disbursed = add('disbursed'), principal = add('principal'), interest = add('interest'), other = add('other');
    const moneyIn = add('money_in'), moneyOut = add('money_out');
    return {
      key: b.key, label: b.label, from: b.from, to: b.to,
      disbursed, principal, interest, other,
      moneyIn, moneyOut, net: round2(moneyIn - moneyOut),
      collections: mine.reduce((s, r) => s + parseInt(String(r.collections ?? 0), 10), 0),
    };
  }

  // ── breakdowns ────────────────────────────────────────────────────────────

  async breakdown(user: TenantJwtPayload, query: Record<string, unknown>) {
    const scope = this.scopeFor(user);
    const period = resolvePeriod(query as StatementQuery);
    const dimension = String(query.dimension ?? '');
    const dims: Record<string, { key: string; label: string }> = {
      'loan-type': { key: `COALESCE(loan_type, '-')`, label: `COALESCE(loan_type, 'No loan')` },
      agent: { key: `COALESCE(agent_id::text, '-')`, label: `COALESCE(agent_name, 'Unassigned')` },
      branch: { key: `COALESCE(branch_id::text, '-')`, label: `COALESCE(branch_name, 'No branch')` },
      mode: { key: `mode`, label: `mode` },
    };
    const d = dims[dimension];
    if (!d) throw new BadRequestException(`dimension must be one of: ${Object.keys(dims).join(', ')}`);
    if (dimension === 'mode' && scope.level !== 'full') throw new ForbiddenException('Only Owner or Admin can see cash and bank totals');

    return this.withSchema(user, async (client) => {
      const p = new Params();
      const cte = this.baseCte(scope, p);
      const from = p.add(period.range.from), to = p.add(period.range.to);
      const res = await client.query(
        `${cte}
         SELECT ${d.key} AS k, ${d.label} AS label,
                COALESCE(SUM(amount) FILTER (WHERE kind = 'DISBURSEMENT'), 0)         AS disbursed,
                COALESCE(SUM(amount) FILTER (WHERE kind = 'COLLECTION_PRINCIPAL'), 0) AS principal,
                COALESCE(SUM(amount) FILTER (WHERE kind = 'COLLECTION_INTEREST'), 0)  AS interest,
                COALESCE(SUM(amount) FILTER (WHERE kind = 'COLLECTION_OTHER'), 0)     AS other,
                COALESCE(SUM(amount) FILTER (WHERE dir = 1), 0)                       AS money_in,
                COALESCE(SUM(amount) FILTER (WHERE dir = -1), 0)                      AS money_out,
                COUNT(DISTINCT loan_id)                                               AS loans
           FROM scoped
          WHERE txn_date BETWEEN ${from}::date AND ${to}::date
          GROUP BY 1, 2
          ORDER BY COALESCE(SUM(amount) FILTER (WHERE dir = 1), 0) DESC, 2`,
        p.values,
      );
      const rows = res.rows.map((r) => ({
        key: r.k as string,
        label: dimension === 'loan-type' ? (LOAN_TYPE_LABELS[r.label as string] ?? (r.label as string)) : (r.label as string),
        disbursed: round2(num(r.disbursed)), principalCollected: round2(num(r.principal)),
        interestCollected: round2(num(r.interest)), otherCollected: round2(num(r.other)),
        moneyIn: round2(num(r.money_in)), moneyOut: round2(num(r.money_out)),
        net: round2(num(r.money_in) - num(r.money_out)), loans: parseInt(String(r.loans), 10),
      }));
      return { fy: period.fy, fyLabel: period.fyLabel, range: period.range, dimension, rows };
    });
  }

  // ── manual entries ────────────────────────────────────────────────────────

  private assertCanPost(user: TenantJwtPayload) {
    if (!MANAGER_ROLES.includes(user.role as UserRole)) {
      throw new ForbiddenException('Only Owner, Admin or Manager can record cash and bank entries');
    }
  }

  private cleanText(value: unknown, label: string, max: number, required = false): string | null {
    if (value === undefined || value === null || value === '') {
      if (required) throw new BadRequestException(`${label} is required`);
      return null;
    }
    if (typeof value !== 'string') throw new BadRequestException(`${label} must be text`);
    const t = value.trim();
    if (!t) {
      if (required) throw new BadRequestException(`${label} is required`);
      return null;
    }
    if (t.length > max) throw new BadRequestException(`${label} is too long (maximum ${max} characters)`);
    return t;
  }

  /** 'CASH' (any case) or a bank account name. Bank types must not use the reserved word CASH. */
  private account(value: unknown, label: string, allowCash: boolean): string {
    const t = this.cleanText(value, label, 60);
    if (!t) return allowCash ? 'CASH' : 'BANK';
    if (t.toUpperCase() === 'CASH') {
      if (!allowCash) throw new BadRequestException(`${label} cannot be CASH for a bank entry`);
      return 'CASH';
    }
    return t;
  }

  async createEntry(user: TenantJwtPayload, dto: CreateEntryDto) {
    this.assertCanPost(user);
    const types = ['CASH_IN', 'CASH_OUT', 'BANK_IN', 'BANK_OUT', 'TRANSFER', 'ADJUSTMENT'];
    if (!dto || !types.includes(dto.type)) throw new BadRequestException(`type must be one of: ${types.join(', ')}`);
    if (!isValidYmd(dto.date)) throw new BadRequestException('date must be a valid YYYY-MM-DD date');
    if (dto.date < '2000-01-01') throw new BadRequestException('date is too far in the past');
    const latest = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // a day of grace for UTC vs IST
    if (dto.date > latest) throw new BadRequestException('date cannot be in the future');
    const amount = parseMoneyAmount(dto.amount);
    const referenceNo = this.cleanText(dto.referenceNo, 'Reference', 100);
    const remarks = this.cleanText(dto.remarks, 'Remarks', 500, dto.type === 'ADJUSTMENT');

    type Leg = { type: 'CREDIT' | 'DEBIT'; account: string };
    let legs: Leg[];
    let category: string = dto.type;
    let groupId: string | null = null;
    switch (dto.type) {
      case 'CASH_IN': legs = [{ type: 'CREDIT', account: 'CASH' }]; break;
      case 'CASH_OUT': legs = [{ type: 'DEBIT', account: 'CASH' }]; break;
      case 'BANK_IN': legs = [{ type: 'CREDIT', account: this.account(dto.accountName, 'Account', false) }]; break;
      case 'BANK_OUT': legs = [{ type: 'DEBIT', account: this.account(dto.accountName, 'Account', false) }]; break;
      case 'ADJUSTMENT': {
        if (dto.direction !== 'IN' && dto.direction !== 'OUT') throw new BadRequestException("direction must be 'IN' or 'OUT' for an adjustment");
        legs = [{ type: dto.direction === 'IN' ? 'CREDIT' : 'DEBIT', account: this.account(dto.accountName, 'Account', true) }];
        break;
      }
      case 'TRANSFER': {
        const from = this.account(dto.fromAccount, 'From account', true);
        const to = this.account(dto.toAccount, 'To account', true);
        if (from.toLowerCase() === to.toLowerCase()) throw new BadRequestException('A transfer needs two different accounts');
        legs = [{ type: 'DEBIT', account: from }, { type: 'CREDIT', account: to }];
        groupId = randomUUID();
        break;
      }
    }

    return this.withSchema(user, async (client) => {
      await client.query('BEGIN');
      let committed = false;
      try {
        const ids: string[] = [];
        for (const leg of legs) {
          const res = await client.query<{ id: string }>(
            `INSERT INTO fund_transactions (transaction_date, type, amount, category, account_name,
                                            entity_type, entity_id, description, reference_number, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [dto.date, leg.type, amount, category, leg.account, groupId ? 'transfer' : null, groupId, remarks, referenceNo, user.sub],
          );
          ids.push(res.rows[0].id);
        }
        await this.activity.record(client, user, {
          action: 'ledger.entry_created',
          entityType: 'ledger_entry',
          entityId: ids[0],
          entityLabel: `${dto.type} — ₹${amount}`,
          metadata: { type: dto.type, amount, date: dto.date, accounts: legs.map((l) => l.account), referenceNo },
        });
        await client.query('COMMIT');
        committed = true;
        return { ids, groupId, type: dto.type, amount, date: dto.date };
      } finally {
        if (!committed) await client.query('ROLLBACK').catch(() => undefined);
      }
    });
  }

  /** Soft delete only: the row stays in the table, flagged, and drops out of every ledger view. */
  async deleteEntry(user: TenantJwtPayload, id: string, reason?: string) {
    if (!LEDGER_ROLES.includes(user.role as UserRole)) throw new ForbiddenException('Only Owner or Admin can delete a ledger entry');
    const rawId = String(id ?? '').replace(/^ft:/, '');
    if (!UUID_RE.test(rawId)) {
      // Posted ledger rows are immutable: they are corrected with a reversal, never deleted.
      throw new BadRequestException('Only manual cash and bank entries can be deleted; reverse a posted ledger transaction instead');
    }
    const why = this.cleanText(reason, 'Reason', 200);

    return this.withSchema(user, async (client) => {
      const found = await client.query<{ id: string; category: string; amount: string; entity_type: string | null; entity_id: string | null }>(
        `SELECT id, category, amount, entity_type, entity_id FROM fund_transactions WHERE id = $1 AND deleted_at IS NULL`,
        [rawId],
      );
      const row = found.rows[0];
      if (!row) {
        // A posted ledger row has the same kind of id; say why it cannot be deleted instead of "not found".
        const posted = await client.query(`SELECT 1 FROM ledger_transactions WHERE id = $1`, [rawId]);
        if (posted.rows.length) {
          throw new BadRequestException('Only manual cash and bank entries can be deleted; reverse a posted ledger transaction instead');
        }
        throw new NotFoundException('Entry not found');
      }
      // Both legs of a transfer go together.
      const res = await client.query<{ id: string }>(
        `UPDATE fund_transactions SET deleted_at = NOW(), deleted_by = $2
          WHERE deleted_at IS NULL AND (id = $1 OR ($3::text IS NOT NULL AND entity_type = 'transfer' AND entity_id = $3))
        RETURNING id`,
        [rawId, user.sub, row.entity_type === 'transfer' ? row.entity_id : null],
      );
      await this.activity.record(client, user, {
        action: 'ledger.entry_deleted',
        entityType: 'ledger_entry',
        entityId: rawId,
        entityLabel: `${row.category} — ₹${row.amount}`,
        metadata: { reason: why, rows: res.rows.length },
      });
      return { deleted: res.rows.length };
    });
  }
}
