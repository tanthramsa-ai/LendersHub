import { saAuthFetch } from './super-admin-auth';

async function authGet<T>(path: string): Promise<T> {
  return saAuthFetch<T>(path);
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
