import client from './client';

export const connectionsApi = {
  list: (projectId: number) =>
    client.get(`/projects/${projectId}/connections`).then((r) => r.data),
  get: (projectId: number, id: number) =>
    client.get(`/projects/${projectId}/connections/${id}`).then((r) => r.data),
  create: (projectId: number, data: any) =>
    client.post(`/projects/${projectId}/connections`, data).then((r) => r.data),
  update: (projectId: number, id: number, data: any) =>
    client.put(`/projects/${projectId}/connections/${id}`, data).then((r) => r.data),
  delete: (projectId: number, id: number) =>
    client.delete(`/projects/${projectId}/connections/${id}`).then((r) => r.data),
  preview: (id: number) =>
    client.post<{ success: boolean; message: string; latency_ms: number }>(
      `/connections/${id}/preview`,
    ).then((r) => r.data),
  test: (data: {
    db_type: string;
    host: string;
    port: number;
    database_name: string;
    username?: string;
    password?: string;
    extra_config?: any;
  }) =>
    client.post<{ success: boolean; message: string; latency_ms: number }>(
      '/connections/test',
      data,
    ).then((r) => r.data),
  sync: (id: number) => client.post(`/connections/${id}/sync`).then((r) => r.data),
  previewSync: (id: number) =>
    client.post(`/connections/${id}/preview-sync`).then((r) => r.data),
  applySync: (id: number, data: { snapshot: any; overrides?: Record<string, any> }) =>
    client.post(`/connections/${id}/sync/apply`, data).then((r) => r.data),
  dataPreview: (id: number, tableId: number, limit?: number) =>
    client.post<{ columns: string[]; rows: any[][] }>(
      `/connections/${id}/data-preview`,
      { tableId, limit: limit || 10 },
    ).then((r) => r.data),
};
