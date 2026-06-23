import client from './client';

export const adminApi = {
  listUsers: (params?: { page?: number; pageSize?: number; search?: string }) =>
    client.get('/admin/users', { params }).then((r) => r.data),
  searchUsers: (params: { q?: string; roleName?: string; roleId?: number; excludeProjectId?: number }) =>
    client.get('/admin/users/search', { params }).then((r) => r.data),
  createUser: (data: {
    username: string;
    email?: string;
    display_name?: string;
    password: string;
    role?: string;
    role_names?: string[];
    role_ids?: number[];
  }) => client.post('/admin/users', data).then((r) => r.data),
  updateRole: (userId: number, role: string) =>
    client.put(`/admin/users/${userId}/role`, { role }).then((r) => r.data),
  setRoles: (userId: number, payload: { role_ids?: number[]; role_names?: string[] }) =>
    client.put(`/admin/users/${userId}/roles`, payload).then((r) => r.data),
  deleteUser: (userId: number) =>
    client.delete(`/admin/users/${userId}`).then((r) => r.data),
  resetPassword: (userId: number, newPassword: string) =>
    client.put(`/admin/users/${userId}/reset-password`, { newPassword }).then((r) => r.data),
  updateDisplayName: (userId: number, display_name: string) =>
    client.put(`/admin/users/${userId}/display-name`, { display_name }).then((r) => r.data),
};
