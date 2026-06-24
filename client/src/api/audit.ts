import client from './client';

export interface AuditOnlineUser {
  id: number;
  username: string;
  display_name: string;
  email: string;
  role: string;
  online: boolean;
  last_seen_at: string | null;
  last_login_at: string | null;
  last_login_ip: string | null;
  roles: string[];
}

export interface AuditOnlineResponse {
  threshold_ms: number;
  total: number;
  online: number;
  users: AuditOnlineUser[];
}

export interface AuditLogEntry {
  id: number;
  category: string;
  action: string;
  actor_user_id: number | null;
  actor_username: string;
  actor_display_name: string | null;
  target_type: string;
  target_id: number | null;
  target_label: string;
  result: 'success' | 'failure';
  message: string;
  ip_address: string;
  user_agent: string;
  metadata: string;
  created_at: string;
}

export interface AuditLogsResponse {
  data: AuditLogEntry[];
  pagination: { page: number; pageSize: number; total: number };
}

export interface AuditLogQuery {
  category?: string;
  action?: string;
  actor?: string;
  result?: 'success' | 'failure';
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export const auditApi = {
  listOnline: () =>
    client.get<AuditOnlineResponse>('/admin/audit/online').then((r) => r.data),

  listLogs: (params: AuditLogQuery = {}) =>
    client.get<AuditLogsResponse>('/admin/audit/logs', { params }).then((r) => r.data),

  exportLogs: (params: AuditLogQuery = {}) =>
    client
      .get('/admin/audit/logs/export', { params, responseType: 'blob' })
      .then((r) => r.data as Blob),

  clearLogs: (before?: string) =>
    client
      .delete<{ success: boolean; deleted: number }>('/admin/audit/logs', {
        params: before ? { before } : undefined,
      })
      .then((r) => r.data),
};
