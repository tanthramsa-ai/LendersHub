import * as SecureStore from 'expo-secure-store';
import { AgentSession, StoredCredentials, LoginMethod } from '../types';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (__DEV__ ? 'http://10.0.2.2:4001' : 'https://api.lendershub.com');

// ─── SecureStore keys ─────────────────────────────────────────────────────────

const KEYS = {
  TOKEN:             'lh_agent_token',
  USER:              'lh_agent_user',
  TENANT:            'lh_agent_tenant',
  EXPIRES_AT:        'lh_agent_expires_at',
  SUBDOMAIN:         'lh_agent_subdomain',
  IDENTIFIER:        'lh_agent_identifier',
  LOGIN_METHOD:      'lh_agent_login_method',
  BIOMETRIC_ENABLED: 'lh_agent_biometric_enabled',
  REMEMBER_ME:       'lh_agent_remember_me',
} as const;

// ─── Token utilities ─────────────────────────────────────────────────────────

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  // Base64url → base64 → decode
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

export function isTokenExpired(token: string): boolean {
  try {
    const payload = decodeJwtPayload(token);
    const exp = payload.exp as number | undefined;
    if (!exp) return false;
    // Add 60-second grace period
    return Date.now() >= (exp - 60) * 1000;
  } catch {
    return true;
  }
}

export function tokenExpiresAt(token: string): number {
  try {
    const payload = decodeJwtPayload(token);
    const exp = payload.exp as number | undefined;
    return exp ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

// ─── Session storage ─────────────────────────────────────────────────────────

export async function saveSession(session: AgentSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.TOKEN,      session.token),
    SecureStore.setItemAsync(KEYS.USER,       JSON.stringify(session.user)),
    SecureStore.setItemAsync(KEYS.TENANT,     JSON.stringify(session.tenant)),
    SecureStore.setItemAsync(KEYS.EXPIRES_AT, String(session.expiresAt)),
  ]);
}

export async function loadSession(): Promise<AgentSession | null> {
  const [token, userStr, tenantStr, expiresAtStr] = await Promise.all([
    SecureStore.getItemAsync(KEYS.TOKEN),
    SecureStore.getItemAsync(KEYS.USER),
    SecureStore.getItemAsync(KEYS.TENANT),
    SecureStore.getItemAsync(KEYS.EXPIRES_AT),
  ]);
  if (!token || !userStr || !tenantStr) return null;
  return {
    token,
    expiresAt: expiresAtStr ? parseInt(expiresAtStr, 10) : tokenExpiresAt(token),
    user:   JSON.parse(userStr),
    tenant: JSON.parse(tenantStr),
  };
}

export async function clearSession(): Promise<void> {
  await Promise.all(Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));
}

// ─── Credential persistence (for remember-me) ─────────────────────────────────

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.SUBDOMAIN,    creds.subdomain),
    SecureStore.setItemAsync(KEYS.IDENTIFIER,   creds.identifier),
    SecureStore.setItemAsync(KEYS.LOGIN_METHOD, creds.loginMethod),
    SecureStore.setItemAsync(KEYS.REMEMBER_ME,  'true'),
  ]);
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const [subdomain, identifier, loginMethod, rememberMe] = await Promise.all([
    SecureStore.getItemAsync(KEYS.SUBDOMAIN),
    SecureStore.getItemAsync(KEYS.IDENTIFIER),
    SecureStore.getItemAsync(KEYS.LOGIN_METHOD),
    SecureStore.getItemAsync(KEYS.REMEMBER_ME),
  ]);
  if (!subdomain || !identifier || rememberMe !== 'true') return null;
  return {
    subdomain,
    identifier,
    loginMethod: (loginMethod as LoginMethod) ?? 'email',
  };
}

export async function clearCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.SUBDOMAIN),
    SecureStore.deleteItemAsync(KEYS.IDENTIFIER),
    SecureStore.deleteItemAsync(KEYS.LOGIN_METHOD),
    SecureStore.deleteItemAsync(KEYS.REMEMBER_ME),
  ]);
}

// ─── Biometric preference ────────────────────────────────────────────────────

export async function getBiometricEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEYS.BIOMETRIC_ENABLED)) === 'true';
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEYS.BIOMETRIC_ENABLED, enabled ? 'true' : 'false');
}

// ─── API fetch wrapper ────────────────────────────────────────────────────────

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await SecureStore.getItemAsync(KEYS.TOKEN);
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; statusCode?: number };
    const message = Array.isArray(body.message)
      ? (body.message as string[]).join('; ')
      : (body.message ?? `Request failed: ${res.status}`);
    const err = new Error(message) as Error & { statusCode: number };
    err.statusCode = body.statusCode ?? res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}
