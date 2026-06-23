import client from './client';

export const dictionaryApi = {
  getDictionary: (connectionId: number, version?: string | number) =>
    client.get(`/dictionary/connections/${connectionId}`, { params: { version } }).then((r) => r.data),
  updateTable: (tableId: number, data: { custom_comment?: string }) =>
    client.patch(`/dictionary/tables/${tableId}`, data).then((r) => r.data),
  updateColumn: (columnId: number, data: { custom_comment?: string; display_name?: string; tags?: string[] }) =>
    client.patch(`/dictionary/columns/${columnId}`, data).then((r) => r.data),
  updateProcedure: (procedureId: number, data: { custom_comment?: string }) =>
    client.patch(`/dictionary/procedures/${procedureId}`, data).then((r) => r.data),
  saveBatch: (data: {
    connection_id: number;
    version_id?: number;
    table_changes?: Array<{ id: number; custom_comment?: string }>;
    column_changes?: Array<{ id: number; custom_comment?: string; display_name?: string; tags?: string[] }>;
    procedure_changes?: Array<{ id: number; custom_comment?: string }>;
  }) => client.post('/dictionary/save', data).then((r) => r.data),
  getVersions: (connectionId: number) =>
    client.get(`/dictionary/versions/${connectionId}`).then((r) => r.data),
  publishVersion: (versionId: number, notes?: string) =>
    client.post(`/dictionary/versions/${versionId}/publish`, { notes }).then((r) => r.data),
  compareVersions: (a: number, b: number) =>
    client.get('/dictionary/versions/compare', { params: { a, b } }).then((r) => r.data),
  rollbackVersion: (versionId: number) =>
    client.post(`/dictionary/versions/${versionId}/rollback`).then((r) => r.data),
  publishLogs: (connectionId: number) =>
    client.get(`/dictionary/versions/connection/${connectionId}/publish-logs`).then((r) => r.data),
  deleteVersion: (versionId: number) =>
    client.delete(`/dictionary/versions/${versionId}`).then((r) => r.data),

  /**
   * Download the dictionary as a file. Returns a suggested filename.
   * Hits the backend with the JWT and triggers a real download in the browser.
   */
  exportDictionary: async (connectionId: number, format: string, version?: string | number): Promise<string> => {
    const response = await client.get(`/dictionary/export/${connectionId}`, {
      params: { format, version },
      responseType: 'blob',
    });
    const cd = (response.headers['content-disposition'] as string) || '';
    const match = cd.match(/filename="?([^"]+)"?/);
    const filename = match?.[1] || `dictionary.${format === 'excel' ? 'xlsx' : format}`;
    const blob = new Blob([response.data], {
      type: response.headers['content-type'] as string,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
  },
  getDrafts: () =>
    client.get('/dictionary/versions/drafts').then((r) => r.data),
  deleteDraft: (versionId: number) =>
    client.delete(`/dictionary/versions/${versionId}`).then((r) => r.data),
  publishVersionWithForce: (versionId: number, notes?: string, force?: boolean) =>
    client.post(`/dictionary/versions/${versionId}/publish`, { notes, force }).then((r) => r.data),
};
