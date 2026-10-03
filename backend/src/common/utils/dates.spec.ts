import { isValidYmd } from './dates';

describe('isValidYmd', () => {
  it.each(['2026-10-03', '2024-02-29', '2000-02-29', '1999-12-31', '2026-01-01'])('accepts %s', (v) => {
    expect(isValidYmd(v)).toBe(true);
  });

  it.each([
    '2026-02-31', '2026-02-29', '2100-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-10-00', '2026-10-32',
    '2026-1-3', '26-10-03', '2026/10/03', '2026-10-03T00:00:00Z', ' 2026-10-03', '', 'abc',
  ])('rejects %s', (v) => {
    expect(isValidYmd(v)).toBe(false);
  });

  it.each([null, undefined, 20261003, {}, [], true])('rejects non-string %p', (v) => {
    expect(isValidYmd(v)).toBe(false);
  });
});
