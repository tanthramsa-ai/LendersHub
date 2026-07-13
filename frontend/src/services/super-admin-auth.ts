const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  sessionStore.clear();
  if (!window.location.pathname.startsWith('/super-admin/login')) {
    window.location.href = '/super-admin/login';
  }
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 && token) {
    redirectToLogin();
    throw new Error('Session expired. Please log in again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { message?: string | string[] }).message;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Request failed'));
  }
  return data as T;
}

async function get<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    redirectToLogin();
    throw new Error('Session expired. Please log in again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { message?: string | string[] }).message;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Request failed'));
  }
  return data as T;
}

/** Authenticated fetch for super-admin APIs. Clears session and redirects on 401. */
export async function saAuthFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionStore.getToken();
  if (!token) {
    redirectToLogin();
    throw new Error('Not authenticated');
  }
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (res.status === 401) {
    redirectToLogin();
    throw new Error('Session expired. Please log in again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { message?: string | string[] }).message;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : (msg ?? `Request failed (${res.status})`));
  }
  return data as T;
}

export interface LoginResponse {
  requiresTwoFactor: boolean;
  totpEnabled: boolean;
  accessToken?: string;
  tempToken?: string;
}

export interface TokenResponse {
  accessToken: string;
}

export interface Setup2faResponse {
  qrCodeDataUrl: string;
  otpauthUrl: string;
}

export const superAdminAuth = {
  login: (email: string, password: string) =>
    post<LoginResponse>('/api/v1/super-admin/auth/login', { email, password }),

  getSetup2fa: (tempToken: string) =>
    get<Setup2faResponse>('/api/v1/super-admin/auth/setup-2fa', tempToken),

  confirmSetup2fa: (token: string, tempToken: string) =>
    post<TokenResponse>('/api/v1/super-admin/auth/setup-2fa', { token }, tempToken),

  verify2fa: (token: string, tempToken: string) =>
    post<TokenResponse>('/api/v1/super-admin/auth/verify-2fa', { token }, tempToken),
};

const STORAGE_KEY = 'sa_token';
const LAST_ACTIVE_KEY = 'sa_last_active';
const INACTIVITY_MS = 30 * 60 * 1000;

export const sessionStore = {
  setToken: (token: string) => {
    sessionStorage.setItem(STORAGE_KEY, token);
    sessionStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
  },
  getToken: (): string | null => {
    const token = sessionStorage.getItem(STORAGE_KEY);
    const lastActive = sessionStorage.getItem(LAST_ACTIVE_KEY);
    if (!token || !lastActive) return null;
    if (Date.now() - parseInt(lastActive) > INACTIVITY_MS) {
      sessionStore.clear();
      return null;
    }
    return token;
  },
  touch: () => {
    if (sessionStorage.getItem(STORAGE_KEY)) {
      sessionStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
    }
  },
  clear: () => {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(LAST_ACTIVE_KEY);
  },
};
