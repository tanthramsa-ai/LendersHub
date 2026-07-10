import { VercelDomainService } from './vercel-domain.service';

describe('VercelDomainService', () => {
  const ORIGINAL_ENV = process.env;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_PROJECT_ID;
    delete process.env.TENANT_ROOT_DOMAIN;
    delete process.env.VERCEL_TEAM_ID;
    fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  function configure() {
    process.env.VERCEL_TOKEN = 'tok_123';
    process.env.VERCEL_PROJECT_ID = 'prj_abc';
    process.env.TENANT_ROOT_DOMAIN = 'lendershub.in';
  }

  it('is a no-op and never calls fetch when unconfigured', async () => {
    const svc = new VercelDomainService();
    expect(svc.enabled).toBe(false);
    await svc.addSubdomain('acme');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the fully-qualified domain to the Vercel project on success', async () => {
    configure();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const svc = new VercelDomainService();
    expect(svc.enabled).toBe(true);

    await svc.addSubdomain('acme');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.vercel.com/v10/projects/prj_abc/domains');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok_123');
    expect(JSON.parse(init.body)).toEqual({ name: 'acme.lendershub.in' });
  });

  it('includes teamId as a query param when set', async () => {
    configure();
    process.env.VERCEL_TEAM_ID = 'team_xyz';
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    await new VercelDomainService().addSubdomain('acme');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.vercel.com/v10/projects/prj_abc/domains?teamId=team_xyz',
    );
  });

  it('treats an already-registered domain (409) as success — no throw', async () => {
    configure();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'domain_already_in_use', message: 'taken' } }),
    });

    await expect(new VercelDomainService().addSubdomain('acme')).resolves.toBeUndefined();
  });

  it('swallows a thrown fetch error so provisioning is never aborted', async () => {
    configure();
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(new VercelDomainService().addSubdomain('acme')).resolves.toBeUndefined();
  });
});
