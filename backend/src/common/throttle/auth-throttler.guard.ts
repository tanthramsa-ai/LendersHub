import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { createHash } from 'crypto';

/**
 * Rate limit for credential endpoints (login, OTP, password reset), keyed by WHO is
 * being attacked rather than by client IP.
 *
 * Why not IP: behind a reverse proxy every request can share one address, so an
 * IP-keyed limit would throttle a whole branch's agents logging in at 9am (and an
 * attacker rotating X-Forwarded-For would walk straight past it). Keying on the
 * account/token being guessed caps guesses per target no matter where they come from,
 * at the cost that someone hammering an account can briefly lock its owner out
 * (the window is a minute).
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const identity = String(
      req.user?.userId ?? req.user?.id ?? body.email ?? body.phone ?? body.tempToken ?? '',
    ).trim().toLowerCase();
    const scope = String(body.subdomain ?? '').toLowerCase();
    // Nothing identifying in the request: fall back to the address so it is still limited.
    const raw = identity ? `${req.route?.path ?? ''}|${scope}|${identity}` : `ip|${req.ip ?? ''}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Replaces the library's "ThrottlerException: Too Many Requests" with something a person can act on. */
  protected async throwThrottlingException(_context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    const wait = Math.max(1, Math.ceil(detail.timeToBlockExpire || detail.timeToExpire || 60));
    throw new HttpException(
      `Too many attempts. Please wait ${wait > 60 ? Math.ceil(wait / 60) + ' minutes' : wait + ' seconds'} and try again.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
