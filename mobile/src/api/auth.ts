import { apiRequest, saveSession, clearSession, loadSession } from './client';
import { AgentSession } from '../types';

export async function login(email: string, password: string, subdomain: string): Promise<AgentSession> {
  const res = await apiRequest<{ accessToken: string; user: AgentSession['user']; tenant: AgentSession['tenant'] }>(
    '/api/v1/tenant/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password, subdomain }) },
  );
  const session: AgentSession = { token: res.accessToken, user: res.user, tenant: res.tenant };
  await saveSession(session);
  return session;
}

export { loadSession, clearSession };
