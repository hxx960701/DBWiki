import client from './client';
import type { Role, Permission } from '../types';

export const rolesApi = {
  list: () => client.get<Role[]>('/roles').then((r) => r.data),
  get: (id: number) => client.get<Role>(`/roles/${id}`).then((r) => r.data),
  create: (data: { name: string; description?: string; permission_codes?: string[] }) =>
    client.post<Role>('/roles', data).then((r) => r.data),
  update: (id: number, data: { name?: string; description?: string; permission_codes?: string[] }) =>
    client.put<Role>(`/roles/${id}`, data).then((r) => r.data),
  delete: (id: number) => client.delete(`/roles/${id}`).then((r) => r.data),
  listUsers: (id: number) =>
    client.get<Array<{ id: number; username: string; email: string }>>(`/roles/${id}/users`).then((r) => r.data),
};

export const permissionsApi = {
  list: () => client.get<Permission[]>('/permissions').then((r) => r.data),
};
