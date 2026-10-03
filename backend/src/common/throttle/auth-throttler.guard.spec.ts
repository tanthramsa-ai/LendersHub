import { AuthThrottlerGuard } from './auth-throttler.guard';

// getTracker is protected and doesn't touch the injected services, so it is exercised directly.
const tracker = (req: Record<string, unknown>) =>
  (AuthThrottlerGuard.prototype as unknown as { getTracker(r: unknown): Promise<string> }).getTracker.call({}, req);

describe('AuthThrottlerGuard key', () => {
  const login = (body: Record<string, unknown>, ip = '10.0.0.1') => tracker({ body, ip, route: { path: '/login' } });

  it('is the same for the same account whatever the client address', async () => {
    const a = await login({ email: 'Ann@Acme.test', subdomain: 'acme' }, '1.1.1.1');
    const b = await login({ email: 'ann@acme.test', subdomain: 'acme' }, '9.9.9.9');
    expect(a).toBe(b);
  });

  it('differs between accounts, so one noisy account does not throttle its neighbours behind the same proxy', async () => {
    expect(await login({ email: 'ann@acme.test', subdomain: 'acme' })).not.toBe(await login({ email: 'bob@acme.test', subdomain: 'acme' }));
  });

  it('differs between organisations using the same email', async () => {
    expect(await login({ email: 'ann@x.test', subdomain: 'acme' })).not.toBe(await login({ email: 'ann@x.test', subdomain: 'beta' }));
  });

  it('keys phone logins and OTP attempts on what is being guessed', async () => {
    expect(await login({ phone: '9876543210', subdomain: 'acme' })).not.toBe(await login({ phone: '9876543211', subdomain: 'acme' }));
    expect(await login({ tempToken: 'tok-1' })).not.toBe(await login({ tempToken: 'tok-2' }));
  });

  it('keys a 2FA attempt on the user the temp token belongs to', async () => {
    const a = await tracker({ body: { token: '123456' }, user: { userId: 'u1' }, ip: '1.1.1.1', route: { path: '/verify-2fa' } });
    const b = await tracker({ body: { token: '654321' }, user: { userId: 'u1' }, ip: '2.2.2.2', route: { path: '/verify-2fa' } });
    expect(a).toBe(b);
  });

  it('falls back to the address when the request names nobody', async () => {
    expect(await login({}, '1.1.1.1')).not.toBe(await login({}, '2.2.2.2'));
  });

  it('never exposes the raw identity in the storage key', async () => {
    expect(await login({ email: 'ann@acme.test', subdomain: 'acme' })).toMatch(/^[0-9a-f]{64}$/);
  });
});
