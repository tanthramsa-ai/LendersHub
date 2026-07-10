import { sessionStore } from './super-admin-auth';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

async function authGet<T>(path: string): Promise<T> {
  const token = sessionStore.getToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Request failed');
  return data as T;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string;
  createdAt: string;
}

export interface AuditLogPage {
  total: number;
  page: number;
  limit: number;
  data: AuditLogEntry[];
  availableActions: string[];
}

export const auditLogApi = {
  list: (params: { page?: number; limit?: number; action?: string; targetType?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.action) qs.set('action', params.action);
    if (params.targetType) qs.set('targetType', params.targetType);
    if (params.search) qs.set('search', params.search);
    return authGet<AuditLogPage>(`/api/v1/super-admin/audit-log?${qs.toString()}`);
  },
};
