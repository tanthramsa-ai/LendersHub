import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { TenantAuthService } from './tenant-auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsService } from '../../sms/sms.service';
import { JwtService } from '@nestjs/jwt';

const PASSWORD = 'Correct-horse-9';
const HASH = bcrypt.hashSync(PASSWORD, 4);

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1', email: 'ann@acme.test', phone: null, password: HASH,
    first_name: 'Ann', last_name: 'Agent', role: 'AGENT', is_active: true, ...overrides,
  };
}

describe('TenantAuthService.login', () => {
  let userRow: ReturnType<typeof makeUser> | undefined;
  let jwtSign: jest.Mock;
  let svc: TenantAuthService;

  const login = (password: string) => svc.login({ email: 'ann@acme.test', password, subdomain: 'acme' });

  beforeEach(() => {
    userRow = makeUser();
    const query = jest.fn(async (sql: string) => (sql.includes('FROM users') ? { rows: userRow ? [userRow] : [] } : { rows: [] }));
    const prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 't1', companyName: 'Acme', subdomain: 'acme', schemaName: 'tenant_acme', status: 'ACTIVE' }) },
      pool: { connect: jest.fn().mockResolvedValue({ query, release: jest.fn() }) },
    } as unknown as PrismaService;
    jwtSign = jest.fn().mockReturnValue('signed.jwt');
    svc = new TenantAuthService(prisma, { sign: jwtSign } as unknown as JwtService, {} as unknown as SmsService);
    jest.spyOn(svc as unknown as { issueOtp: () => Promise<void> }, 'issueOtp').mockResolvedValue(undefined);
  });

  it('signs in with the right password (no phone: straight to a session)', async () => {
    const res = await login(PASSWORD);
    expect(res).toEqual(expect.objectContaining({ accessToken: 'signed.jwt' }));
  });

  it('asks for the OTP when the user has a phone', async () => {
    userRow = makeUser({ phone: '9876543210' });
    const res = await login(PASSWORD);
    expect(res).toEqual(expect.objectContaining({ requiresOtp: true, tempToken: 'signed.jwt' }));
  });

  it('rejects a wrong password', async () => {
    await expect(login('wrong-password-1')).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    expect(jwtSign).not.toHaveBeenCalled();
  });

  // The regression: a user row with no stored password used to accept ANY password, and
  // with no phone on file that was a complete session.
  it.each([['NULL', null], ['empty', '']])('rejects every password for an account whose stored password is %s', async (_l, stored) => {
    userRow = makeUser({ password: stored });
    for (const attempt of ['anything', '', PASSWORD, 'x']) {
      await expect(login(attempt)).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    }
    expect(jwtSign).not.toHaveBeenCalled();
  });

  it('rejects an unknown account with the same message as a wrong password', async () => {
    userRow = undefined;
    await expect(login(PASSWORD)).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
  });

  it('does not reveal a deactivated account to someone who does not know its password', async () => {
    userRow = makeUser({ is_active: false });
    await expect(login('wrong-password-1')).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
  });

  it('tells the real owner their account is deactivated once the password checks out', async () => {
    userRow = makeUser({ is_active: false });
    await expect(login(PASSWORD)).rejects.toThrow('Your account has been deactivated');
  });
});
