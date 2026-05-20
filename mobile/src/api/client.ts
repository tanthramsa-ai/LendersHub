import * as SecureStore from 'expo-secure-store';
import { AgentSession } from '../types';

const API_URL = 'http://10.0.2.2:4001'; // Android emulator → host localhost

async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync('agent_token');
}

export async function apiRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function saveSession(session: AgentSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync('agent_token', session.token),
    SecureStore.setItemAsync('agent_user', JSON.stringify(session.user)),
    SecureStore.setItemAsync('agent_tenant', JSON.stringify(session.tenant)),
  ]);
}

export async function loadSession(): Promise<AgentSession | null> {
  const [token, userStr, tenantStr] = await Promise.all([
    SecureStore.getItemAsync('agent_token'),
    SecureStore.getItemAsync('agent_user'),
    SecureStore.getItemAsync('agent_tenant'),
  ]);
  if (!token || !userStr || !tenantStr) return null;
  return {
    token,
    user: JSON.parse(userStr),
    tenant: JSON.parse(tenantStr),
  };
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync('agent_token'),
    SecureStore.deleteItemAsync('agent_user'),
    SecureStore.deleteItemAsync('agent_tenant'),
  ]);
}
