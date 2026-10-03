import { BadRequestException } from '@nestjs/common';
import { ACTIVE_LOAN_STATUSES, ACTIVE_LOANS_SQL, LENT_LOANS_SQL, LOAN_STATUSES, loanStatusFilter } from './loan-status';

describe('loan status helpers', () => {
  it('treats APPROVED and DISBURSED as active, and nothing else', () => {
    expect([...ACTIVE_LOAN_STATUSES]).toEqual(['APPROVED', 'DISBURSED']);
    expect(ACTIVE_LOANS_SQL).toBe("('APPROVED','DISBURSED')");
  });

  it('counts only loans past approval as lent', () => {
    expect(LENT_LOANS_SQL).toBe("('APPROVED','DISBURSED','CLOSED','DEFAULTED')");
    expect(LENT_LOANS_SQL).not.toMatch(/PENDING|REJECTED/);
  });

  it('expands ACTIVE to both active statuses, case-insensitively', () => {
    expect(loanStatusFilter('ACTIVE')).toEqual(['APPROVED', 'DISBURSED']);
    expect(loanStatusFilter(' active ')).toEqual(['APPROVED', 'DISBURSED']);
  });

  it('passes every real status through on its own', () => {
    for (const s of LOAN_STATUSES) expect(loanStatusFilter(s)).toEqual([s]);
    expect(loanStatusFilter('approved')).toEqual(['APPROVED']);
  });

  it('rejects an unknown status with a 400 instead of letting Postgres fail', () => {
    expect(() => loanStatusFilter('FOO')).toThrow(BadRequestException);
    expect(() => loanStatusFilter("DISBURSED' OR 1=1 --")).toThrow(BadRequestException);
  });
});
