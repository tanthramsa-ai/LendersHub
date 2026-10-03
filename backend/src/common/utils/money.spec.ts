import { BadRequestException } from '@nestjs/common';
import { MAX_MONEY_AMOUNT, parseMoneyAmount } from './money';

describe('parseMoneyAmount', () => {
  it.each([
    [100, 100],
    [523.08, 523.08],
    ['100', 100],
    [' 250.5 ', 250.5],
    [10.999, 11],          // rounded to paise, as numeric(…,2) did before
    [0.005, 0.01],
    [MAX_MONEY_AMOUNT, MAX_MONEY_AMOUNT],
  ])('accepts %p as %p', (raw, expected) => {
    expect(parseMoneyAmount(raw)).toBe(expected);
  });

  it.each([
    ['abc'], [''], ['  '], ['1e3'], ['NaN'], ['Infinity'], ['-5'], ['5,000'], ['0x10'],
    [true], [false], [[5]], [{}], [null], [undefined],
    [NaN], [Infinity], [-Infinity], [0], [-1], [0.004], [MAX_MONEY_AMOUNT + 1],
  ])('rejects %p', (raw) => {
    expect(() => parseMoneyAmount(raw)).toThrow(BadRequestException);
  });

  it('names the field in the message', () => {
    expect(() => parseMoneyAmount('abc', 'Payment amount')).toThrow('Payment amount must be a valid number');
    expect(() => parseMoneyAmount(0, 'Payment amount')).toThrow('Payment amount must be greater than zero');
  });
});
