import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantLedgerPostingService } from '../ledger/tenant-ledger-posting.service';
import { TenantFundersService } from '../funders/tenant-funders.service';
import { LIVE_LEDGER_SQL, OUTSTANDING_PRINCIPAL_EXPR, liveLedgerSql, liveFunderTxnSql, outstandingPrincipalExpr } from '../ledger/ledger-sql';
import { LEDGER_ROLES, UserRole } from '../common/roles';

export type OutstandingGroupBy = 'agent' | 'customer' | 'loanType';

/**
 * The reporting suite (requirements doc §12, plus the Fund Utilization ratio
 * from §5.2). Every figure is derived from ledger_transactions through the
 * shared LIVE_LEDGER_SQL predicate, so reports can never disagree with the
 * dashboard or the daily view about what counts as real money.
 *
 * One report is deliberately partial: the bank/UPI/gateway reconciliation
 * report (§12) can only reconcile what this system knows about — it reports
 * settled vs. outstanding per non-agent channel. True bank-statement matching
 * needs an external feed that doesn't exist yet, so the response carries
 * `statementMatchingAvailable: false` rather than implying more than it can.
 */
@Injectable()
export class TenantReportsService {
  constructor(
    private prisma: PrismaService,
    private ledgerPosting: TenantLedgerPostingService,
    private funders: TenantFundersService,
  ) {}

  private async withSchema<T>(schemaName: string, fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private assertAccess(user: TenantJwtPayload) {
    if (!LEDGER_ROLES.includes(user.role as UserRole)) throw new ForbiddenException('Only Owner or Admin can view reports');
  }

  private assertDate(d: string, label: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequestException(`${label} must be YYYY-MM-DD`);
  }

  private assertMonth(m: string, label: string) {
    if (!/^\d{4}-\d{2}$/.test(m)) throw new BadRequestException(`${label} must be YYYY-MM`);
  }

  /** §12: Daily collection report — principal, interest, total by agent. */
  async dailyCollection(user: TenantJwtPayload, date: string) {
    this.assertAccess(user);
    this.assertDate(date, 'date');
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      const res = await client.query(
        `SELECT lt.agent_id,
                COALESCE(u.first_name || ' ' || u.last_name, 'Unattributed') AS agent_name,
                COUNT(*) AS transaction_count,
                COALESCE(SUM(lt.principal_amount), 0) AS principal,
                COALESCE(SUM(lt.interest_amount), 0) AS interest,
                COALESCE(SUM(lt.fee_amount), 0) AS fee,
                COALESCE(SUM(lt.total_amount), 0) AS total
         FROM ledger_transactions lt
         LEFT JOIN users u ON u.id = lt.agent_id
         WHERE lt.transaction_type = 'COLLECTION' AND ${liveLedgerSql('lt')}
           AND lt.business_date = $1
         GROUP BY lt.agent_id, agent_name
         ORDER BY total DESC`,
        [date],
      );
      const rows = res.rows.map((r) => ({
        agentId: (r.agent_id as string) ?? null,
        agentName: r.agent_name as string,
        transactionCount: parseInt(r.transaction_count),
        principal: parseFloat(r.principal),
        interest: parseFloat(r.interest),
        fee: parseFloat(r.fee),
        total: parseFloat(r.total),
      }));
      return { date, rows, totals: sumTotals(rows) };
    });
  }

  /** §12: Monthly collection report — principal and interest by month. */
  async monthlyCollection(user: TenantJwtPayload, fromMonth: string, toMonth: string) {
    this.assertAccess(user);
    this.assertMonth(fromMonth, 'from');
    this.assertMonth(toMonth, 'to');
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      const res = await client.query(
        `SELECT to_char(date_trunc('month', business_date), 'YYYY-MM') AS month,
                COUNT(*) AS transaction_count,
                COALESCE(SUM(principal_amount), 0) AS principal,
                COALESCE(SUM(interest_amount), 0) AS interest,
                COALESCE(SUM(fee_amount), 0) AS fee,
                COALESCE(SUM(total_amount), 0) AS total
         FROM ledger_transactions
         WHERE transaction_type = 'COLLECTION' AND ${LIVE_LEDGER_SQL}
           AND business_date >= $1::date AND business_date < ($2::date + INTERVAL '1 month')
         GROUP BY 1 ORDER BY 1 ASC`,
        [`${fromMonth}-01`, `${toMonth}-01`],
      );
      const rows = res.rows.map((r) => ({
        month: r.month as string,
        transactionCount: parseInt(r.transaction_count),
        principal: parseFloat(r.principal),
        interest: parseFloat(r.interest),
        fee: parseFloat(r.fee),
        total: parseFloat(r.total),
      }));
      return { fromMonth, toMonth, rows, totals: sumTotals(rows) };
    });
  }

  /** §12: Outstanding principal report by agent, customer or loan type. */
  async outstandingPrincipal(user: TenantJwtPayload, groupBy: OutstandingGroupBy) {
    this.assertAccess(user);
    const grouping: Record<OutstandingGroupBy, { key: string; label: string; join: string }> = {
      agent: {
        key: 'l.loan_officer_id',
        label: `COALESCE(u.first_name || ' ' || u.last_name, 'Unassigned')`,
        join: `LEFT JOIN users u ON u.id = l.loan_officer_id`,
      },
      customer: {
        key: 'l.customer_id',
        label: `COALESCE(c.first_name || ' ' || c.last_name, 'Unknown')`,
        join: `LEFT JOIN customers c ON c.id = l.customer_id`,
      },
      loanType: {
        key: `COALESCE(lt2.name, l.cycle_type)`,
        label: `COALESCE(lt2.name, l.cycle_type, 'Unclassified')`,
        join: `LEFT JOIN loan_types lt2 ON lt2.id = l.loan_type_id`,
      },
    };
    const g = grouping[groupBy];
    if (!g) throw new BadRequestException('groupBy must be one of: agent, customer, loanType');

    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      // Outstanding is computed from the ledger (§7.1 formula), grouped by a
      // dimension that lives on the loan — so the ledger is joined to loans
      // rather than grouping on ledger columns directly.
      const res = await client.query(
        `SELECT ${g.key} AS group_key, ${g.label} AS group_label,
                COUNT(DISTINCT l.id) AS loan_count,
                (${outstandingPrincipalExpr('txn')}) AS outstanding
         FROM ledger_transactions txn
         JOIN loans l ON l.id = txn.loan_id
         ${g.join}
         WHERE ${liveLedgerSql('txn')}
           AND l.deleted_at IS NULL
         GROUP BY group_key, group_label
         HAVING (${outstandingPrincipalExpr('txn')}) <> 0
         ORDER BY outstanding DESC`,
      );
      const rows = res.rows.map((r) => ({
        groupKey: (r.group_key as string) ?? null,
        groupLabel: r.group_label as string,
        loanCount: parseInt(r.loan_count),
        outstanding: parseFloat(r.outstanding),
      }));
      return {
        groupBy,
        rows,
        totalOutstanding: round2(rows.reduce((s, r) => s + r.outstanding, 0)),
      };
    });
  }

  /** §5.2 + §12: Fund utilization — deployed principal against capital raised. */
  async fundUtilization(user: TenantJwtPayload) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      const totalFund = await this.funders.getTotalCapitalWithClient(client, user.schemaName);
      const res = await client.query<{ outstanding: string; disbursed: string; collected_principal: string }>(
        `SELECT (${OUTSTANDING_PRINCIPAL_EXPR}) AS outstanding,
                COALESCE(SUM(principal_amount) FILTER (WHERE transaction_type = 'DISBURSEMENT'), 0) AS disbursed,
                COALESCE(SUM(principal_amount) FILTER (WHERE transaction_type = 'COLLECTION'), 0) AS collected_principal
         FROM ledger_transactions WHERE ${LIVE_LEDGER_SQL}`,
      );
      const outstanding = parseFloat(res.rows[0].outstanding);
      const availableFund = round2(totalFund - outstanding);
      return {
        totalFund,
        outstandingPrincipal: outstanding,
        availableFund,
        totalDisbursed: parseFloat(res.rows[0].disbursed),
        principalRecovered: parseFloat(res.rows[0].collected_principal),
        // Null rather than 0 when there's no capital: a ratio against zero is
        // undefined, and showing 0% would read as "nothing deployed".
        utilizationPct: totalFund > 0 ? round2((outstanding / totalFund) * 100) : null,
      };
    });
  }

  /** §12: Funder capital report. */
  async funderCapital(user: TenantJwtPayload) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.funders.ensureTables(client, user.schemaName);
      const res = await client.query(
        `SELECT f.id, f.name, f.is_active,
           COALESCE((SELECT SUM(ft.amount) FROM funder_transactions ft
             WHERE ft.funder_id = f.id AND ft.transaction_type = 'CONTRIBUTION' AND ${liveFunderTxnSql('ft')}), 0) AS contributions,
           COALESCE((SELECT SUM(ft.amount) FROM funder_transactions ft
             WHERE ft.funder_id = f.id AND ft.transaction_type = 'WITHDRAWAL' AND ${liveFunderTxnSql('ft')}), 0) AS withdrawals,
           COALESCE((SELECT SUM(ft.amount) FROM funder_transactions ft
             WHERE ft.funder_id = f.id AND ft.transaction_type = 'ADJUSTMENT' AND ${liveFunderTxnSql('ft')}), 0) AS adjustments,
           COALESCE((SELECT SUM(lfa.amount) FROM loan_funder_allocations lfa
             JOIN loans l ON l.id = lfa.loan_id
             WHERE lfa.funder_id = f.id AND l.status IN ('APPROVED','DISBURSED') AND l.deleted_at IS NULL), 0) AS allocated_principal
         FROM funders f ORDER BY f.name ASC`,
      );
      const rows = res.rows.map((r) => {
        const contributions = parseFloat(r.contributions);
        const withdrawals = parseFloat(r.withdrawals);
        const adjustments = parseFloat(r.adjustments);
        return {
          funderId: r.id as string,
          funderName: r.name as string,
          isActive: r.is_active as boolean,
          contributions, withdrawals, adjustments,
          currentCapital: round2(contributions - withdrawals + adjustments),
          allocatedPrincipal: parseFloat(r.allocated_principal),
        };
      });
      return {
        rows,
        totals: {
          contributions: round2(rows.reduce((s, r) => s + r.contributions, 0)),
          withdrawals: round2(rows.reduce((s, r) => s + r.withdrawals, 0)),
          currentCapital: round2(rows.reduce((s, r) => s + r.currentCapital, 0)),
          allocatedPrincipal: round2(rows.reduce((s, r) => s + r.allocatedPrincipal, 0)),
        },
      };
    });
  }

  /** §12: Agent settlement / reconciliation report — collected vs. settled per agent. */
  async agentSettlement(user: TenantJwtPayload, from?: string, to?: string) {
    this.assertAccess(user);
    if (from) this.assertDate(from, 'from');
    if (to) this.assertDate(to, 'to');
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      const params: unknown[] = [];
      let dateFilter = '';
      if (from) { params.push(from); dateFilter += ` AND lt.business_date >= $${params.length}`; }
      if (to) { params.push(to); dateFilter += ` AND lt.business_date <= $${params.length}`; }

      const res = await client.query(
        `SELECT lt.agent_id,
                COALESCE(u.first_name || ' ' || u.last_name, 'Unattributed') AS agent_name,
                COUNT(*) AS collection_count,
                COALESCE(SUM(lt.total_amount), 0) AS collected,
                COALESCE(SUM(lt.total_amount) FILTER (WHERE lt.status = 'RECONCILED'), 0) AS settled,
                COALESCE(SUM(lt.total_amount) FILTER (WHERE lt.status = 'POSTED'), 0) AS pending_settlement
         FROM ledger_transactions lt
         LEFT JOIN users u ON u.id = lt.agent_id
         WHERE lt.transaction_type = 'COLLECTION'
           AND lt.payment_channel IN ('AGENT_CASH','AGENT_UPI')
           AND ${liveLedgerSql('lt')}
           ${dateFilter}
         GROUP BY lt.agent_id, agent_name
         ORDER BY pending_settlement DESC, collected DESC`,
        params,
      );
      const rows = res.rows.map((r) => ({
        agentId: (r.agent_id as string) ?? null,
        agentName: r.agent_name as string,
        collectionCount: parseInt(r.collection_count),
        collected: parseFloat(r.collected),
        settled: parseFloat(r.settled),
        pendingSettlement: parseFloat(r.pending_settlement),
      }));
      return {
        from: from ?? null, to: to ?? null,
        rows,
        totals: {
          collected: round2(rows.reduce((s, r) => s + r.collected, 0)),
          settled: round2(rows.reduce((s, r) => s + r.settled, 0)),
          pendingSettlement: round2(rows.reduce((s, r) => s + r.pendingSettlement, 0)),
        },
      };
    });
  }

  /**
   * §12: Bank / UPI / payment-gateway reconciliation report. Partial by
   * necessity — see the class doc comment. Reports settled vs. outstanding per
   * non-agent channel from this system's own records only.
   */
  async channelReconciliation(user: TenantJwtPayload, from?: string, to?: string) {
    this.assertAccess(user);
    if (from) this.assertDate(from, 'from');
    if (to) this.assertDate(to, 'to');
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      const params: unknown[] = [];
      let dateFilter = '';
      if (from) { params.push(from); dateFilter += ` AND business_date >= $${params.length}`; }
      if (to) { params.push(to); dateFilter += ` AND business_date <= $${params.length}`; }

      const res = await client.query(
        `SELECT COALESCE(payment_channel, 'UNSPECIFIED') AS channel,
                COUNT(*) AS transaction_count,
                COALESCE(SUM(total_amount), 0) AS total,
                COALESCE(SUM(total_amount) FILTER (WHERE status = 'RECONCILED'), 0) AS reconciled,
                COALESCE(SUM(total_amount) FILTER (WHERE status = 'POSTED'), 0) AS unreconciled,
                COUNT(*) FILTER (WHERE external_reference IS NULL) AS missing_reference
         FROM ledger_transactions
         WHERE transaction_type = 'COLLECTION'
           AND (payment_channel IS NULL OR payment_channel NOT IN ('AGENT_CASH','AGENT_UPI'))
           AND ${LIVE_LEDGER_SQL}
           ${dateFilter}
         GROUP BY channel ORDER BY total DESC`,
        params,
      );
      const rows = res.rows.map((r) => ({
        channel: r.channel as string,
        transactionCount: parseInt(r.transaction_count),
        total: parseFloat(r.total),
        reconciled: parseFloat(r.reconciled),
        unreconciled: parseFloat(r.unreconciled),
        // An electronic payment with no provider reference can't be matched
        // against a statement later — worth surfacing as a data-quality count.
        missingReference: parseInt(r.missing_reference),
      }));
      return {
        from: from ?? null, to: to ?? null,
        statementMatchingAvailable: false as const,
        rows,
        totals: {
          total: round2(rows.reduce((s, r) => s + r.total, 0)),
          reconciled: round2(rows.reduce((s, r) => s + r.reconciled, 0)),
          unreconciled: round2(rows.reduce((s, r) => s + r.unreconciled, 0)),
        },
      };
    });
  }

  /** §12: NPA / write-off report. */
  async npaWriteOff(user: TenantJwtPayload) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      const npaRes = await client.query(
        `SELECT l.id, l.loan_number, l.status, l.principal, l.npa_marked_at, l.npa_reason,
                c.first_name || ' ' || c.last_name AS customer_name,
                COALESCE(SUM(i.total_amount - i.paid_amount) FILTER (WHERE i.status <> 'PAID'), 0) AS outstanding_due,
                COUNT(i.id) FILTER (WHERE i.status = 'OVERDUE') AS overdue_installments
         FROM loans l
         JOIN customers c ON c.id = l.customer_id
         LEFT JOIN installments i ON i.loan_id = l.id AND i.deleted_at IS NULL
         WHERE l.deleted_at IS NULL AND (l.status = 'DEFAULTED' OR l.npa_marked_at IS NOT NULL)
         GROUP BY l.id, l.loan_number, l.status, l.principal, l.npa_marked_at, l.npa_reason, customer_name
         ORDER BY outstanding_due DESC`,
      );
      // Write-offs are negative-principal ADJUSTMENT transactions — the only
      // sanctioned way to reduce outstanding principal without a collection.
      const writeOffRes = await client.query(
        `SELECT lt.id, lt.business_date, lt.principal_amount, lt.remarks,
                l.loan_number, c.first_name || ' ' || c.last_name AS customer_name,
                u.first_name || ' ' || u.last_name AS posted_by
         FROM ledger_transactions lt
         LEFT JOIN loans l ON l.id = lt.loan_id
         LEFT JOIN customers c ON c.id = lt.customer_id
         LEFT JOIN users u ON u.id = lt.created_by
         WHERE lt.transaction_type = 'ADJUSTMENT' AND lt.principal_amount < 0
           AND ${liveLedgerSql('lt')}
         ORDER BY lt.business_date DESC`,
      );

      const npaLoans = npaRes.rows.map((r) => ({
        loanId: r.id as string,
        loanNumber: r.loan_number as string,
        customerName: r.customer_name as string,
        status: r.status as string,
        principal: parseFloat(r.principal),
        outstandingDue: parseFloat(r.outstanding_due),
        overdueInstallments: parseInt(r.overdue_installments),
        npaMarkedAt: (r.npa_marked_at as string) ?? null,
        npaReason: (r.npa_reason as string) ?? null,
      }));
      const writeOffs = writeOffRes.rows.map((r) => ({
        transactionId: r.id as string,
        businessDate: r.business_date as string,
        loanNumber: (r.loan_number as string) ?? null,
        customerName: (r.customer_name as string) ?? null,
        amount: parseFloat(r.principal_amount),
        remarks: (r.remarks as string) ?? null,
        postedBy: (r.posted_by as string) ?? null,
      }));
      return {
        npaLoans, writeOffs,
        totals: {
          npaCount: npaLoans.length,
          npaOutstanding: round2(npaLoans.reduce((s, r) => s + r.outstandingDue, 0)),
          writeOffCount: writeOffs.length,
          writeOffAmount: round2(writeOffs.reduce((s, r) => s + r.amount, 0)),
        },
      };
    });
  }

  /** §12: Loan-level statement — every disbursement and collection on one loan, with a running balance. */
  async loanStatement(user: TenantJwtPayload, loanId: string) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      const loanRes = await client.query(
        `SELECT l.id, l.loan_number, l.principal, l.status, l.disbursed_at, l.interest_rate, l.cycle_type,
                c.first_name || ' ' || c.last_name AS customer_name, c.phone
         FROM loans l JOIN customers c ON c.id = l.customer_id
         WHERE l.id = $1 AND l.deleted_at IS NULL`,
        [loanId],
      );
      if (!loanRes.rows[0]) throw new NotFoundException('Loan not found');
      const loan = loanRes.rows[0];

      const txnRes = await client.query(
        `SELECT lt.*, p.receipt_number, u.first_name || ' ' || u.last_name AS agent_name
         FROM ledger_transactions lt
         LEFT JOIN payments p ON p.id = lt.payment_id
         LEFT JOIN users u ON u.id = lt.agent_id
         WHERE lt.loan_id = $1 AND ${liveLedgerSql('lt')}
         ORDER BY lt.business_date ASC, lt.created_at ASC`,
        [loanId],
      );

      // Running outstanding principal, applying the §7.1 sign rules per row so
      // the statement reconciles line-by-line to the closing balance.
      let running = 0;
      const lines = txnRes.rows.map((r) => {
        const principal = parseFloat(r.principal_amount);
        const type = r.transaction_type as string;
        const delta = type === 'DISBURSEMENT' ? principal
          : type === 'COLLECTION' ? -principal
          : principal; // REFUND / ADJUSTMENT / FEE / OTHER apply as signed
        running = round2(running + delta);
        return {
          transactionId: r.id as string,
          businessDate: r.business_date as string,
          transactionType: type,
          principalAmount: principal,
          interestAmount: parseFloat(r.interest_amount),
          feeAmount: parseFloat(r.fee_amount),
          totalAmount: parseFloat(r.total_amount),
          paymentChannel: (r.payment_channel as string) ?? null,
          receiptNumber: (r.receipt_number as string) ?? null,
          agentName: (r.agent_name as string) ?? null,
          remarks: (r.remarks as string) ?? null,
          runningOutstandingPrincipal: running,
        };
      });

      return {
        loan: {
          id: loan.id as string,
          loanNumber: loan.loan_number as string,
          customerName: loan.customer_name as string,
          phone: loan.phone as string,
          principal: parseFloat(loan.principal),
          interestRate: parseFloat(loan.interest_rate),
          status: loan.status as string,
          cycleType: (loan.cycle_type as string) ?? null,
          disbursedAt: (loan.disbursed_at as string) ?? null,
        },
        lines,
        totals: {
          disbursed: round2(lines.filter((l) => l.transactionType === 'DISBURSEMENT').reduce((s, l) => s + l.principalAmount, 0)),
          principalCollected: round2(lines.filter((l) => l.transactionType === 'COLLECTION').reduce((s, l) => s + l.principalAmount, 0)),
          interestCollected: round2(lines.filter((l) => l.transactionType === 'COLLECTION').reduce((s, l) => s + l.interestAmount, 0)),
          closingOutstandingPrincipal: running,
        },
      };
    });
  }

  /** §12: Audit report of manual adjustments and reversals (§10 traceability). */
  async adjustmentAudit(user: TenantJwtPayload, from?: string, to?: string) {
    this.assertAccess(user);
    if (from) this.assertDate(from, 'from');
    if (to) this.assertDate(to, 'to');
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      const params: unknown[] = [];
      let dateFilter = '';
      if (from) { params.push(from); dateFilter += ` AND lt.business_date >= $${params.length}`; }
      if (to) { params.push(to); dateFilter += ` AND lt.business_date <= $${params.length}`; }

      // Deliberately does NOT use LIVE_LEDGER_SQL: an audit report must show
      // reversals and reversed originals, which that predicate hides.
      const res = await client.query(
        `SELECT lt.*, l.loan_number, c.first_name || ' ' || c.last_name AS customer_name,
                u.first_name || ' ' || u.last_name AS posted_by,
                orig.transaction_type AS reversed_type, orig.total_amount AS reversed_amount
         FROM ledger_transactions lt
         LEFT JOIN loans l ON l.id = lt.loan_id
         LEFT JOIN customers c ON c.id = lt.customer_id
         LEFT JOIN users u ON u.id = lt.created_by
         LEFT JOIN ledger_transactions orig ON orig.id = lt.reversal_of_id
         WHERE (lt.transaction_type = 'ADJUSTMENT' OR lt.reversal_of_id IS NOT NULL OR lt.status = 'REVERSED')
           ${dateFilter}
         ORDER BY lt.created_at DESC`,
        params,
      );
      const rows = res.rows.map((r) => ({
        transactionId: r.id as string,
        businessDate: r.business_date as string,
        createdAt: r.created_at as string,
        transactionType: r.transaction_type as string,
        status: r.status as string,
        entryKind: r.reversal_of_id ? 'REVERSAL' : (r.status === 'REVERSED' ? 'REVERSED_ORIGINAL' : 'ADJUSTMENT'),
        loanNumber: (r.loan_number as string) ?? null,
        customerName: (r.customer_name as string) ?? null,
        principalAmount: parseFloat(r.principal_amount),
        totalAmount: parseFloat(r.total_amount),
        remarks: (r.remarks as string) ?? null,
        postedBy: (r.posted_by as string) ?? null,
        reversalOfId: (r.reversal_of_id as string) ?? null,
        reversedType: (r.reversed_type as string) ?? null,
        reversedAmount: r.reversed_amount != null ? parseFloat(r.reversed_amount as string) : null,
      }));
      return {
        from: from ?? null, to: to ?? null,
        rows,
        totals: {
          adjustmentCount: rows.filter((r) => r.entryKind === 'ADJUSTMENT').length,
          reversalCount: rows.filter((r) => r.entryKind === 'REVERSAL').length,
        },
      };
    });
  }
}

function sumTotals<T extends { principal: number; interest: number; fee: number; total: number; transactionCount: number }>(rows: T[]) {
  return {
    transactionCount: rows.reduce((s, r) => s + r.transactionCount, 0),
    principal: round2(rows.reduce((s, r) => s + r.principal, 0)),
    interest: round2(rows.reduce((s, r) => s + r.interest, 0)),
    fee: round2(rows.reduce((s, r) => s + r.fee, 0)),
    total: round2(rows.reduce((s, r) => s + r.total, 0)),
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
