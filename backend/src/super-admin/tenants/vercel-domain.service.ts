import { Injectable, Logger } from '@nestjs/common';

/**
 * Registers tenant subdomains (e.g. acme.lendershub.in) with the Vercel project
 * so Vercel routes them to this app and issues a TLS certificate.
 *
 * DNS itself stays on GoDaddy via a wildcard `*` CNAME → cname.vercel-dns.com,
 * so the subdomain already resolves; this call just tells Vercel to serve it.
 *
 * Fully no-op unless VERCEL_TOKEN, VERCEL_PROJECT_ID and TENANT_ROOT_DOMAIN are
 * all set — keeps local dev and non-Vercel deploys untouched. Failures are
 * logged but never abort tenant provisioning.
 */
@Injectable()
export class VercelDomainService {
  private readonly logger = new Logger(VercelDomainService.name);

  private get config() {
    const token = process.env.VERCEL_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID;
    const rootDomain = process.env.TENANT_ROOT_DOMAIN;
    if (!token || !projectId || !rootDomain) return null;
    return { token, projectId, rootDomain, teamId: process.env.VERCEL_TEAM_ID };
  }

  /** True when Vercel domain registration is configured. */
  get enabled(): boolean {
    return this.config !== null;
  }

  /**
   * Add `{subdomain}.{rootDomain}` to the Vercel project.
   * Idempotent: a domain already attached to the project is treated as success.
   */
  async addSubdomain(subdomain: string): Promise<void> {
    const cfg = this.config;
    if (!cfg) {
      this.logger.debug(`Vercel not configured — skipping domain registration for "${subdomain}"`);
      return;
    }

    const domain = `${subdomain}.${cfg.rootDomain}`;
    const query = cfg.teamId ? `?teamId=${encodeURIComponent(cfg.teamId)}` : '';
    const url = `https://api.vercel.com/v10/projects/${encodeURIComponent(cfg.projectId)}/domains${query}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
      });

      if (res.ok) {
        this.logger.log(`Registered Vercel domain "${domain}"`);
        return;
      }

      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      const code = body?.error?.code;
      // Already attached to THIS project → success. Attached elsewhere → real error.
      if (res.status === 409 || code === 'domain_already_in_use' || code === 'domain_already_exists') {
        this.logger.log(`Vercel domain "${domain}" already registered — ok`);
        return;
      }
      this.logger.error(`Vercel domain registration failed for "${domain}" (${res.status} ${code ?? ''}): ${body?.error?.message ?? 'unknown error'}`);
    } catch (err) {
      this.logger.error(`Vercel domain registration errored for "${domain}": ${(err as Error)?.message}`);
    }
  }
}
