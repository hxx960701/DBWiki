import client from './client';

export const systemApi = {
  getInfo: () =>
    client.get<{
      database_type: string;
      users: number;
      connections: number;
      versions: number;
      tables: number;
    }>('/admin/system/info').then((r) => r.data),

  getDatabaseConfig: () =>
    client.get<{
      type: string;
      mysql: { host: string; port: number; database: string; user: string; password: string };
    }>('/admin/system/database-config').then((r) => r.data),

  saveDatabaseConfig: (data: { host: string; port: number; database: string; user: string; password: string }) =>
    client.put('/admin/system/database-config', data).then((r) => r.data),

  testMysql: () =>
    client.post<{ success: boolean; message: string }>('/admin/system/test-mysql').then((r) => r.data),

  migrate: () =>
    client.post<{ success: boolean; message: string }>('/admin/system/migrate').then((r) => r.data),
};
