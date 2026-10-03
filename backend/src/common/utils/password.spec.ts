import { BadRequestException } from '@nestjs/common';
import { assertStrongPassword } from './password';

describe('assertStrongPassword', () => {
  it.each(['abcd1234', 'Secret99', 'a1a1a1a1', 'Zz-Edge-Pass-9!', 'p4ssw0rd with spaces'])('accepts %s', (v) => {
    expect(() => assertStrongPassword(v)).not.toThrow();
  });

  it.each([
    ['too short', 'abc123'], ['7 characters', 'abcde12'], ['letters only', 'abcdefgh'], ['digits only', '12345678'],
    ['symbols only', '!@#$%^&*'], ['empty', ''], ['over 72 bytes', 'a1'.repeat(37)],
    ['a number', 12345678], ['null', null], ['undefined', undefined], ['an array', ['abcd1234']],
  ])('rejects %s', (_label, v) => {
    expect(() => assertStrongPassword(v)).toThrow(BadRequestException);
  });

  it('counts bytes, not characters, against bcrypt\'s 72-byte limit', () => {
    expect(() => assertStrongPassword('ab1é'.repeat(15))).toThrow('at most 72');
  });

  it('uses the supplied label', () => {
    expect(() => assertStrongPassword('short1', 'New password')).toThrow('New password must be at least 8 characters');
  });
});
