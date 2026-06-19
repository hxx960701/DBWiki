import { create } from 'zustand';
import { dictionaryApi } from '../api/dictionary';
import { connectionsApi } from '../api/connections';
import type { DictionaryVersion, DictionaryTable, DictionaryColumn, DictionaryIndex } from '../types';

interface TableWithDetails extends DictionaryTable {
  columns: DictionaryColumn[];
  indexes: DictionaryIndex[];
}

export interface PendingTableChange {
  id: number;
  custom_comment?: string;
}
export interface PendingColumnChange {
  id: number;
  custom_comment?: string;
  display_name?: string;
  tags?: string[];
}

interface SyncDiff {
  latest_version: { id: number; version_number: number; status: string } | null;
  tables_added: any[];
  tables_removed: string[];
  tables_changed: any[];
  snapshot: { tables: any[] };
}

interface DictionaryState {
  versions: DictionaryVersion[];
  currentVersion: DictionaryVersion | null;
  tables: TableWithDetails[];
  selectedTableId: number | null;
  loading: boolean;
  syncing: boolean;

  // Pending changes (in-memory only; flushed via saveDictionary).
  pendingTableChanges: Record<number, PendingTableChange>;
  pendingColumnChanges: Record<number, PendingColumnChange>;

  // Sync diff UI state
  syncDiff: SyncDiff | null;
  syncDiffLoading: boolean;
  syncOverrides: Record<string, { custom_comment?: string; display_name?: string; tags?: string[] }>;

  fetchVersions: (connectionId: number) => Promise<void>;
  fetchDictionary: (connectionId: number, version?: string | number) => Promise<void>;
  syncConnection: (connectionId: number) => Promise<any>;
  previewSync: (connectionId: number) => Promise<void>;
  applySyncPreview: (connectionId: number) => Promise<any>;
  clearSyncDiff: () => void;
  setSyncOverride: (key: string, value: { custom_comment?: string; display_name?: string; tags?: string[] }) => void;
  selectTable: (tableId: number | null) => void;
  setTablePending: (tableId: number, change: Partial<PendingTableChange>) => void;
  setColumnPending: (columnId: number, change: Partial<PendingColumnChange>) => void;
  clearPendingChanges: () => void;
  hasPendingChanges: () => boolean;
  saveDictionary: (connectionId: number) => Promise<void>;
  publishCurrent: (notes: string) => Promise<void>;
}

export const useDictionaryStore = create<DictionaryState>((set, get) => ({
  versions: [],
  currentVersion: null,
  tables: [],
  selectedTableId: null,
  loading: false,
  syncing: false,
  pendingTableChanges: {},
  pendingColumnChanges: {},
  syncDiff: null,
  syncDiffLoading: false,
  syncOverrides: {},

  fetchVersions: async (connectionId) => {
    const data = await dictionaryApi.getVersions(connectionId);
    set({ versions: Array.isArray(data) ? data : [] });
  },

  fetchDictionary: async (connectionId, version) => {
    set({ loading: true });
    try {
      const result = await dictionaryApi.getDictionary(connectionId, version);
      set({
        currentVersion: result.version,
        tables: result.tables || [],
        loading: false,
        selectedTableId: result.tables?.[0]?.id || null,
        pendingTableChanges: {},
        pendingColumnChanges: {},
      });
    } catch {
      set({ loading: false });
    }
  },

  /**
   * Legacy "sync + apply in one shot" — used by the ProjectDetail quick-sync button.
   */
  syncConnection: async (connectionId) => {
    set({ syncing: true });
    try {
      const v = await connectionsApi.sync(connectionId);
      await get().fetchDictionary(connectionId);
      await get().fetchVersions(connectionId);
      set({ syncing: false });
      return v;
    } catch (e) {
      set({ syncing: false });
      throw e;
    }
  },

  previewSync: async (connectionId) => {
    set({ syncDiffLoading: true, syncOverrides: {} });
    try {
      const diff = await connectionsApi.previewSync(connectionId);
      set({ syncDiff: diff, syncDiffLoading: false });
    } catch {
      set({ syncDiffLoading: false });
    }
  },

  applySyncPreview: async (connectionId) => {
    const diff = get().syncDiff;
    if (!diff) throw new Error('No diff to apply');
    set({ syncing: true });
    try {
      const v = await connectionsApi.applySync(connectionId, {
        snapshot: diff.snapshot,
        overrides: get().syncOverrides,
      });
      set({ syncing: false, syncDiff: null, syncOverrides: {} });
      await get().fetchDictionary(connectionId);
      await get().fetchVersions(connectionId);
      return v;
    } catch (e) {
      set({ syncing: false });
      throw e;
    }
  },

  clearSyncDiff: () => set({ syncDiff: null, syncOverrides: {} }),

  setSyncOverride: (key, value) => {
    set((s) => ({ syncOverrides: { ...s.syncOverrides, [key]: value } }));
  },

  selectTable: (tableId) => set({ selectedTableId: tableId }),

  setTablePending: (tableId, change) => {
    set((s) => ({
      pendingTableChanges: {
        ...s.pendingTableChanges,
        [tableId]: { ...(s.pendingTableChanges[tableId] || { id: tableId }), ...change },
      },
    }));
  },

  setColumnPending: (columnId, change) => {
    set((s) => ({
      pendingColumnChanges: {
        ...s.pendingColumnChanges,
        [columnId]: { ...(s.pendingColumnChanges[columnId] || { id: columnId }), ...change },
      },
    }));
  },

  clearPendingChanges: () =>
    set({ pendingTableChanges: {}, pendingColumnChanges: {} }),

  hasPendingChanges: () => {
    const s = get();
    return Object.keys(s.pendingTableChanges).length > 0
      || Object.keys(s.pendingColumnChanges).length > 0;
  },

  saveDictionary: async (connectionId) => {
    const s = get();
    const table_changes = Object.values(s.pendingTableChanges);
    const column_changes = Object.values(s.pendingColumnChanges);
    if (table_changes.length === 0 && column_changes.length === 0) {
      return;
    }
    const result = await dictionaryApi.saveBatch({
      connection_id: connectionId,
      version_id: s.currentVersion?.id,
      table_changes,
      column_changes,
    });
    set({ pendingTableChanges: {}, pendingColumnChanges: {} });
    await s.fetchDictionary(connectionId, s.currentVersion?.id);
    await s.fetchVersions(connectionId);
    return result;
  },

  publishCurrent: async (notes) => {
    const v = get().currentVersion;
    if (!v) throw new Error('No version to publish');
    await dictionaryApi.publishVersion(v.id, notes);
    await get().fetchDictionary(v.connection_id, v.id);
    await get().fetchVersions(v.connection_id);
  },
}));
