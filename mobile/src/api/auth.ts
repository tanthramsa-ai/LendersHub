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

interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: AgentSession['user'];
  tenant: AgentSession['tenant'];
}

export async function login(
  identifier: string,
  password: string,
  subdomain: string,
  loginMethod: LoginMethod,
): Promise<AgentSession> {
  const body =
    loginMethod === 'email'
      ? { email: identifier.trim(), password, subdomain: subdomain.trim().toLowerCase() }
      : { phone: identifier.trim(), password, subdomain: subdomain.trim().toLowerCase() };

  const res = await apiRequest<LoginResponse>('/api/v1/tenant/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
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
