import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

export interface AgeingResult {
  schemaName: string;
  aged: number;
  restored: number;
}

/**
 * Ages unpaid installments past their due date into the OVERDUE state.
 *
 * Nothing else in the application performs this transition — installments are
 * created as PENDING and only ever move on payment — so without this job
 * `overdue_count` stays 0 forever and every downstream signal that reads it
 * (the Collections "Overdue" tab, agent notifications, and the NPA flag on the
 * loan lists) is permanently silent.
 *
 * Only PENDING installments are aged. A PARTIALLY_PAID installment is left
 * alone even when it is past due: the financial roll-ups treat PENDING and
 * OVERDUE as "nothing received" and compute outstanding from the full
 * principal, so flipping a partially-paid row to OVERDUE would overstate the
 * book. This matches how loan reopen already restores statuses.
 */
@Injectable()
export class OverdueAgeingService {
  private readonly logger = new Logger(OverdueAgeingService.name);

  constructor(private prisma: PrismaService) {}

  /** Runs daily at 07:30 IST (02:00 UTC), before the 08:00 IST notification run. */
  @Cron('0 2 * * *')
  async runDailyAgeing() {
    this.logger.log('Ageing overdue installments…');
    const results = await this.runAll();
    const aged = results.reduce((n, r) => n + r.aged, 0);
    const restored = results.reduce((n, r) => n + r.restored, 0);
    this.logger.log(
      `Ageing complete: ${aged} marked overdue, ${restored} restored across ${results.length} tenants`,
    );
  }

  async runAll(): Promise<AgeingResult[]> {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { subdomain: true, schemaName: true },
    });

    const results: AgeingResult[] = [];
    for (const tenant of tenants) {
      if (!tenant.schemaName) continue;
      try {
        results.push(await this.runForTenant(tenant.schemaName));
      } catch (e) {
        this.logger.error(
          `Ageing failed for ${tenant.subdomain}: ${(e as Error).message}`,
        );
      }
    }
    return results;
  }

  async runForTenant(schemaName: string): Promise<AgeingResult> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);

      // PENDING + past due + nothing received  ->  OVERDUE
      const agedRes = await client.query(
        `UPDATE installments i
            SET status = 'OVERDUE'::installment_status
           FROM loans l
          WHERE l.id = i.loan_id
            AND i.status = 'PENDING'
            AND i.paid_amount = 0
            AND i.due_date < CURRENT_DATE
            AND l.deleted_at IS NULL
            AND l.status IN ('DISBURSED','DEFAULTED')`,
      );

      // Self-healing: an OVERDUE row whose due date is no longer in the past
      // (rescheduled loan, corrected due date) goes back to PENDING.
      const restoredRes = await client.query(
        `UPDATE installments i
            SET status = 'PENDING'::installment_status
           FROM loans l
          WHERE l.id = i.loan_id
            AND i.status = 'OVERDUE'
            AND i.paid_amount = 0
            AND i.due_date >= CURRENT_DATE
            AND l.deleted_at IS NULL`,
      );

      const result = {
        schemaName,
        aged: agedRes.rowCount ?? 0,
        restored: restoredRes.rowCount ?? 0,
      };
      if (result.aged || result.restored) {
        this.logger.log(
          `${schemaName}: ${result.aged} aged to OVERDUE, ${result.restored} restored to PENDING`,
        );
      }
      return result;
    } finally {
      client.release();
    }
  }
}
