import client from './client';
import type { AuthResponse, User } from '../types';

export const authApi = {
  login: (data: { username: string; password: string }) =>
    client.post<AuthResponse>('/auth/login', data).then((r) => r.data),
  getProfile: () => client.get<User>('/auth/profile').then((r) => r.data),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    client.put<void>('/auth/password', data).then((r) => r.data),
  /**
   * Client-driven liveness ping. Called from useHeartbeat only while the user
   * is actively interacting with a visible tab. The server updates
   * users.last_seen_at; the response is 204.
   */
  heartbeat: () => client.post<void>('/auth/heartbeat').then(() => undefined),
};
