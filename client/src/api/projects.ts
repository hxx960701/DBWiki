import client from './client';

export const projectsApi = {
  list: (params?: { page?: number; pageSize?: number; search?: string }) =>
    client.get('/projects', { params }).then((r) => r.data),
  get: (id: number) =>
    client.get(`/projects/${id}`).then((r) => r.data),
  create: (data: { name: string; description?: string }) =>
    client.post('/projects', data).then((r) => r.data),
  update: (id: number, data: { name: string; description?: string }) =>
    client.put(`/projects/${id}`, data).then((r) => r.data),
  delete: (id: number) =>
    client.delete(`/projects/${id}`).then((r) => r.data),
  addMember: (id: number, data: { userId: number; roleName?: string; role_id?: number; role?: string }) =>
    client.post(`/projects/${id}/members`, data).then((r) => r.data),
  addMembersBatch: (id: number, data: { user_ids: number[]; roleName?: string; role_id?: number }) =>
    client.post(`/projects/${id}/members/batch`, data).then((r) => r.data),
  updateMember: (id: number, userId: number, data: { roleName?: string; role_id?: number }) =>
    client.put(`/projects/${id}/members/${userId}`, data).then((r) => r.data),
  removeMember: (id: number, userId: number) =>
    client.delete(`/projects/${id}/members/${userId}`).then((r) => r.data),
  listRoleBindings: (id: number) =>
    client.get(`/projects/${id}/role-bindings`).then((r) => r.data),
  addRoleBinding: (id: number, data: { role_id?: number; roleName?: string }) =>
    client.post(`/projects/${id}/role-bindings`, data).then((r) => r.data),
  removeRoleBinding: (id: number, bindingId: number) =>
    client.delete(`/projects/${id}/role-bindings/${bindingId}`).then((r) => r.data),
};
