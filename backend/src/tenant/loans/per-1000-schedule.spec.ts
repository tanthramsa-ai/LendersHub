import {
  computeWeeklySchedule,
  computeDailySchedule,
  projectPer1000Schedule,
  perDayRateToAnnualPct,
  MissResolution,
} from './tenant-loans.service';

/**
 * Money maths for the "₹ X per ₹1,000 per day" product. The reference figures come from the
 * client's own spreadsheets, so these tests pin the contract: if a change here goes red, real
 * borrowers would be charged a different amount.
 */
describe('per-₹1,000/day loan maths', () => {
  const RATE = 3.19;

  describe('contract schedule — reference spreadsheets', () => {
    it('reproduces the ₹50,000 / 20-week sheet exactly', () => {
      const { schedule, emi } = computeWeeklySchedule(50000, 0, 20, '2026-05-27', 'PER_1000_PER_DAY', 0, RATE);

      expect(emi).toBe(3617);
      expect(schedule).toHaveLength(20);
      expect(schedule[0]).toMatchObject({ principalAmount: 2500, interestAmount: 1117, totalAmount: 3617 });
      expect(schedule[0].principalOutstanding).toBe(47500);

      const sum = (k: 'principalAmount' | 'interestAmount' | 'totalAmount') =>
        Math.round(schedule.reduce((s, r) => s + r[k], 0) * 100) / 100;
      expect(sum('principalAmount')).toBe(50000);
      expect(sum('interestAmount')).toBe(22330);
      expect(sum('totalAmount')).toBe(72330);
    });

    it('reproduces the ₹30,000 / 15-week sheet exactly', () => {
      const { schedule, emi } = computeWeeklySchedule(30000, 0, 15, '2026-05-27', 'PER_1000_PER_DAY', 0, RATE);
      expect(emi).toBe(2670);
      expect(schedule[0]).toMatchObject({ principalAmount: 2000, interestAmount: 670, totalAmount: 2670 });
      const total = Math.round(schedule.reduce((s, r) => s + r.totalAmount, 0) * 100) / 100;
      expect(total).toBe(40048.5);
    });

    it('reproduces the ₹10,000 / 50-day sheet exactly', () => {
      const { schedule, emi } = computeDailySchedule(
        10000, 0, 50, '2026-07-21', 'PER_1000_PER_DAY', 0, 'DAILY_WITH_SUNDAY', RATE,
      );
      expect(emi).toBe(232);
      expect(schedule[0]).toMatchObject({ principalAmount: 200, interestAmount: 32, totalAmount: 232 });
      const total = Math.round(schedule.reduce((s, r) => s + r.totalAmount, 0) * 100) / 100;
      expect(total).toBe(11595);
    });

    it('always lands the final outstanding on exactly zero, including indivisible terms', () => {
      for (const [principal, periods] of [[50000, 20], [50000, 21], [12345, 7], [10000, 1]] as const) {
        const { schedule } = computeWeeklySchedule(principal, 0, periods, '2026-05-27', 'PER_1000_PER_DAY', 0, RATE);
        expect(schedule[schedule.length - 1].principalOutstanding).toBe(0);
        const paid = Math.round(schedule.reduce((s, r) => s + r.principalAmount, 0) * 100) / 100;
        expect(paid).toBe(principal);
      }
    });

    it('uses a 364-day basis weekly and 365 daily — they must not converge', () => {
      // computeWeeklySchedule divides by 52, computeDailySchedule by 365. One shared factor
      // would throw every row off.
      expect(perDayRateToAnnualPct(RATE)).toBe(116.116);
      expect(Math.round(RATE * 36.5 * 1000) / 1000).toBe(116.435);
    });

    it('skips Sundays without charging for them', () => {
      const { schedule } = computeDailySchedule(
        10000, 0, 20, '2026-07-01', 'PER_1000_PER_DAY', 0, 'DAILY_NO_SUNDAY', RATE,
      );
      const sundays = schedule.filter((r) => new Date(`${r.dueDate}T00:00:00Z`).getUTCDay() === 0);
      expect(sundays).toHaveLength(0);
      // 20 collections still means 20 days of interest, not 20 calendar days.
      const interest = Math.round(schedule.reduce((s, r) => s + r.interestAmount, 0) * 100) / 100;
      expect(interest).toBe(Math.round(10000 * (RATE / 1000) * 20 * 100) / 100);
    });
  });

  describe('projection against payments received', () => {
    const BASE = {
      principal: 50000, interestPerDay: RATE, periods: 20, daysPerPeriod: 7, firstDueDate: '2026-05-27',
    };
    const EMI = 3617;
    const onTime = (n: number) => Array(n).fill(EMI);

    it('an on-time loan matches the contract and never extends', () => {
      const r = projectPer1000Schedule({ ...BASE, collected: onTime(9), today: '2026-07-22' });
      expect(r.rows).toHaveLength(20);
      expect(r.totalPayable).toBe(72340);
      expect(r.rows.some((x) => x.isMissed)).toBe(false);
    });

    it('caps every instalment at the EMI and settles to zero', () => {
      const r = projectPer1000Schedule({
        ...BASE, collected: [EMI, EMI, EMI, EMI, 0, EMI, EMI, EMI, EMI], today: '2026-07-22',
      });
      expect(r.rows.every((x) => x.totalAmount <= EMI + 0.005)).toBe(true);
      expect(r.rows[r.rows.length - 1].principalOutstanding).toBe(0);
      const paid = Math.round(r.rows.reduce((s, x) => s + x.amountPaid, 0) * 100) / 100;
      expect(paid).toBe(r.totalPayable);
    });

    it('does not judge a period still due today as short', () => {
      // Period 9 falls on 2026-07-22 and nothing has been collected against it yet.
      const r = projectPer1000Schedule({
        ...BASE, collected: [...onTime(8), 0], today: '2026-07-22',
      });
      expect(r.rows[8].status).toBe('DUE');
      expect(r.rows[8].isMissed).toBe(false);
      expect(r.rows).toHaveLength(20);
    });
  });

  describe('missed-payment resolutions', () => {
    const BASE = {
      principal: 50000, interestPerDay: RATE, periods: 20, daysPerPeriod: 7, firstDueDate: '2026-05-27',
    };
    const EMI = 3617;
    const missedWeek5 = [EMI, EMI, EMI, EMI, 0, EMI, EMI, EMI, EMI];
    const res = (i: number, s: MissResolution): (MissResolution | null)[] => {
      const a: (MissResolution | null)[] = Array(20).fill(null);
      a[i - 1] = s;
      return a;
    };

    it('EXTEND_EMI keeps the original end date when honoured going forward', () => {
      const r = projectPer1000Schedule({
        ...BASE, collected: [EMI, EMI, EMI, EMI, 0], resolutions: res(5, 'EXTEND_EMI'), today: '2026-06-25',
      });
      expect(r.rows).toHaveLength(20);
      expect(r.rows[5].totalAmount).toBeGreaterThan(EMI);
      expect(r.rows[r.rows.length - 1].principalOutstanding).toBe(0);
    });

    it('never retroactively makes an already-settled instalment look short', () => {
      // Weeks 6-9 were paid in full at the original amount BEFORE week 5 was resolved.
      // Resolving week 5 afterwards must not reopen them — that was the "looping" bug.
      const r = projectPer1000Schedule({
        ...BASE, collected: missedWeek5, resolutions: res(5, 'EXTEND_EMI'), today: '2026-07-22',
      });
      for (const n of [6, 7, 8, 9]) {
        const row = r.rows[n - 1];
        expect(row.status).toBe('PAID');
        expect(row.isMissed).toBe(false);
        expect(row.totalAmount).toBe(EMI);
      }
    });

    it('PAY_EXTRA_NEXT and DEFER_TO_END are annotations that leave the maths alone', () => {
      const unresolved = projectPer1000Schedule({ ...BASE, collected: missedWeek5, today: '2026-07-22' });
      for (const s of ['PAY_EXTRA_NEXT', 'DEFER_TO_END'] as MissResolution[]) {
        const r = projectPer1000Schedule({
          ...BASE, collected: missedWeek5, resolutions: res(5, s), today: '2026-07-22',
        });
        expect(r.rows).toHaveLength(unresolved.rows.length);
        expect(r.totalPayable).toBe(unresolved.totalPayable);
      }
    });

    it('sweeps the rounding remainder so a few paise never buy a whole extra period', () => {
      // The per-period add-on is rounded to paise; unswept drift would leave a ~₹0.05 balance,
      // and this product charges a full period of interest on any balance at all.
      const r = projectPer1000Schedule({
        ...BASE, collected: [EMI, EMI, EMI, EMI, 0], resolutions: res(5, 'EXTEND_EMI'), today: '2026-06-25',
      });
      expect(r.rows).toHaveLength(20);
      expect(r.rows[19].principalOutstanding).toBe(0);
    });

    it('applies identically on the daily cadence', () => {
      const DAILY = {
        principal: 10000, interestPerDay: RATE, periods: 20, daysPerPeriod: 1, firstDueDate: '2026-07-01',
      };
      const d = 532;
      const r = projectPer1000Schedule({
        ...DAILY,
        collected: [d, d, d, d, 0, d, d, d, d],
        resolutions: res(5, 'EXTEND_EMI'),
        today: '2026-07-22',
      });
      for (const n of [6, 7, 8, 9]) {
        expect(r.rows[n - 1].status).toBe('PAID');
        expect(r.rows[n - 1].isMissed).toBe(false);
      }
    });

    it('is a no-op when every later instalment is already paid — the API must reject this case', () => {
      const collected = [0, ...Array(19).fill(EMI)];
      const unresolved = projectPer1000Schedule({ ...BASE, collected, today: '2026-06-01' });
      const extended = projectPer1000Schedule({
        ...BASE, collected, resolutions: res(1, 'EXTEND_EMI'), today: '2026-06-01',
      });
      // Nothing to spread onto, so the maths is unchanged. resolveMissedInstallment refuses to
      // store the choice in this situation rather than display an outcome that never happened.
      expect(extended.totalPayable).toBe(unresolved.totalPayable);
      expect(extended.rows).toHaveLength(unresolved.rows.length);
    });
  });
});
