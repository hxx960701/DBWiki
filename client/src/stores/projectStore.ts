import { create } from 'zustand';
import { projectsApi } from '../api/projects';
import type { Project } from '../types';

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  loading: boolean;
  total: number;
  fetchProjects: (params?: { page?: number; search?: string }) => Promise<void>;
  fetchProject: (id: number) => Promise<void>;
  createProject: (data: { name: string; description?: string }) => Promise<void>;
  updateProject: (id: number, data: { name: string; description?: string }) => Promise<void>;
  deleteProject: (id: number) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProject: null,
  loading: false,
  total: 0,

  fetchProjects: async (params) => {
    set({ loading: true });
    try {
      const response = await projectsApi.list(params);
      set({ projects: response.data, total: response.pagination?.total ?? 0, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchProject: async (id) => {
    set({ loading: true });
    try {
      const data = await projectsApi.get(id);
      set({ currentProject: data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createProject: async (data) => {
    await projectsApi.create(data);
  },

  updateProject: async (id, data) => {
    await projectsApi.update(id, data);
  },

  deleteProject: async (id) => {
    await projectsApi.delete(id);
  },
}));
