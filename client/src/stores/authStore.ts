import { create } from 'zustand';
import { authApi } from '../api/auth';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  fetchProfile: () => Promise<void>;
  hasPermission: (code: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem('dbwiki_token'),
  isAuthenticated: !!localStorage.getItem('dbwiki_token'),
  loading: !!localStorage.getItem('dbwiki_token'),

  login: async (username, password) => {
    const { token, user } = await authApi.login({ username, password });
    localStorage.setItem('dbwiki_token', token);
    set({ token, user, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem('dbwiki_token');
    set({ token: null, user: null, isAuthenticated: false });
  },

  fetchProfile: async () => {
    try {
      const user = await authApi.getProfile();
      set({ user, isAuthenticated: true, loading: false });
    } catch {
      localStorage.removeItem('dbwiki_token');
      set({ token: null, user: null, isAuthenticated: false, loading: false });
    }
  },

  hasPermission: (code: string) => {
    const u = get().user;
    if (!u) return false;
    // Legacy admins implicitly have everything (mirrors server-side fast path).
    if (u.role === 'admin') return true;
    return Array.isArray(u.permissions) && u.permissions.includes(code);
  },
}));
