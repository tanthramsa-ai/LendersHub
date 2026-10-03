import { BadRequestException } from '@nestjs/common';

/** Upper bound for a single money amount; far above any real loan, well inside numeric(15,2). */
export const MAX_MONEY_AMOUNT = 1_000_000_000;

/**
 * Validates an amount taken from a request body and returns it rounded to paise.
 *
 * Request DTOs here are interfaces, so the global ValidationPipe never checks their
 * types — an `amount` of "abc", true or [5] reaches the service untouched. A bare
 * `!amount || amount <= 0` lets "abc" through (NaN comparisons are false), and
 * Postgres numeric accepts NaN, which then poisons every SUM over the ledger.
 *
 * Accepts a finite number or a plain decimal string ("100", "523.08"); anything else
 * (booleans, arrays, "1e3", "NaN", Infinity) is rejected.
 */
export function parseMoneyAmount(raw: unknown, label = 'Amount'): number {
  let value: number;
  if (typeof raw === 'number') {
    value = raw;
  } else if (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw.trim())) {
    value = Number(raw.trim());
  } else {
    throw new BadRequestException(`${label} must be a valid number`);
  }
  if (!Number.isFinite(value)) throw new BadRequestException(`${label} must be a valid number`);
  const rounded = Math.round(value * 100) / 100;
  if (rounded <= 0) throw new BadRequestException(`${label} must be greater than zero`);
  if (rounded > MAX_MONEY_AMOUNT) throw new BadRequestException(`${label} is too large`);
  return rounded;
}
