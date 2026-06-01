import {
  apiRequest,
  saveSession,
  clearSession,
  loadSession,
  saveCredentials,
  loadCredentials,
  clearCredentials,
  tokenExpiresAt,
} from './client';
import { AgentSession, LoginMethod } from '../types';

interface LoginFullResponse {
  accessToken: string;
  expiresIn: number;
  user: AgentSession['user'];
  tenant: AgentSession['tenant'];
}

interface LoginOtpResponse {
  requiresOtp: true;
  tempToken: string;
  maskedPhone: string;
  tenant: AgentSession['tenant'];
}

export type LoginResult =
  | { type: 'session'; session: AgentSession }
  | { type: 'otp'; tempToken: string; maskedPhone: string; tenant: AgentSession['tenant'] };

export async function login(
  identifier: string,
  password: string,
  subdomain: string,
  loginMethod: LoginMethod,
): Promise<LoginResult> {
  const body =
    loginMethod === 'email'
      ? { email: identifier.trim(), password, subdomain: subdomain.trim().toLowerCase() }
      : { phone: identifier.trim(), password, subdomain: subdomain.trim().toLowerCase() };

  const res = await apiRequest<LoginFullResponse | LoginOtpResponse>(
    '/api/v1/tenant/auth/login',
    { method: 'POST', body: JSON.stringify(body) },
  );

  if ((res as LoginOtpResponse).requiresOtp) {
    const otp = res as LoginOtpResponse;
    return { type: 'otp', tempToken: otp.tempToken, maskedPhone: otp.maskedPhone, tenant: otp.tenant };
  }

  const full = res as LoginFullResponse;
  const session: AgentSession = {
    token: full.accessToken,
    expiresAt: tokenExpiresAt(full.accessToken) || Date.now() + full.expiresIn * 1000,
    user: full.user,
    tenant: full.tenant,
  };
  await saveSession(session);
  return { type: 'session', session };
}

export async function verifyLoginOtp(
  tempToken: string,
  otp: string,
): Promise<AgentSession> {
  const res = await apiRequest<LoginFullResponse>('/api/v1/tenant/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ tempToken, otp }),
  });
  const session: AgentSession = {
    token: res.accessToken,
    expiresAt: tokenExpiresAt(res.accessToken) || Date.now() + res.expiresIn * 1000,
    user: res.user,
    tenant: res.tenant,
  };
  await saveSession(session);
  return session;
}

export { loadSession, clearSession, saveCredentials, loadCredentials, clearCredentials };
