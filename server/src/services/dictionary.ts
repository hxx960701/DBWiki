import knex from '../database/connection.js';
import { decrypt } from './encryption.js';
import { createAdapter } from '../adapters/factory.js';
import type { ConnectionConfig } from '../adapters/types.js';

/**
 * Introspection / sync pipeline, broken into two phases so the UI can offer
 * a "preview the diff before applying" flow:
 *
 *   1. introspectAndDiff(connectionId) — connect to the live database, fetch
 *      tables/columns/indexes/procedures, compare against the latest stored
 *      version (draft or published), and return a structured diff plus the
 *      full new snapshot. Does NOT write anything.
 *
 *   2. applySyncSnapshot(connectionId, snapshot, userId, overrides) — given
 *      a snapshot from step 1, persist it as a new draft version. User
 *      overrides (custom_comment, display_name, tags) keyed by `table.column`
 *      are applied to newly-added columns; for surviving columns the previous
 *      version's edits are preserved automatically.
 *
 *   3. syncConnection(connectionId, userId) — convenience wrapper that runs
 *      both phases in one call. Used by POST /connections/:id/sync.
 */

export interface ColumnSnapshot {
  column_name: string;
  column_type: string;
  is_nullable: 'YES' | 'NO';
  column_key: string;
  column_default: string | null;
  extra: string;
  column_comment: string;
  ordinal_position: number;
}

export interface IndexSnapshot {
  index_name: string;
  index_type: string;
  columns: string[];
  is_unique: boolean;
}

export interface TableSnapshot {
  table_name: string;
  table_comment: string;
  engine: string;
  row_count: number;
  columns: ColumnSnapshot[];
  indexes: IndexSnapshot[];
}

export interface ProcedureSnapshot {
  procedure_name: string;
  procedure_type: string;       // 'PROCEDURE' | 'FUNCTION'
  return_type: string;
  parameters: Array<{ name: string; type: string; mode: string; default: string | null }>;
  definition: string;
  procedure_comment: string;
  last_modified: string;
}

export interface ColumnDiff {
  column_name: string;
  type_changed?: { old: string; new: string };
  comment_changed?: { old: string; new: string };
  nullable_changed?: { old: string; new: string };
  default_changed?: { old: string | null; new: string | null };
  key_changed?: { old: string; new: string };
}

export interface TableDiff {
  table_name: string;
  comment_changed?: { old: string; new: string };
  columns_added: ColumnSnapshot[];
  columns_removed: string[];
  columns_changed: ColumnDiff[];
}

export interface ProcedureDiff {
  procedure_name: string;
  type_changed?: { old: string; new: string };
  return_type_changed?: { old: string; new: string };
  parameters_changed?: { old: string; new: string };
  definition_changed?: { old: string; new: string };
  comment_changed?: { old: string; new: string };
}

export interface IntrospectionResult {
  latest_version: { id: number; version_number: number; status: string } | null;
  tables_added: TableSnapshot[];
  tables_removed: string[];
  tables_changed: TableDiff[];
  procedures_added: ProcedureSnapshot[];
  procedures_removed: string[];
  procedures_changed: ProcedureDiff[];
  // Full snapshot of the live database. Pass back to /sync/apply unchanged.
  snapshot: { tables: TableSnapshot[]; procedures: ProcedureSnapshot[] };
}

async function loadAdapter(connectionId: number) {
  const connection = await knex('database_connections').where({ id: connectionId }).first();
  if (!connection) throw new Error('Connection not found');

  const config: ConnectionConfig = {
    host: connection.host,
    port: connection.port,
    database: connection.database_name,
    username: connection.username,
    password: decrypt(connection.encrypted_password),
    extraConfig: JSON.parse(connection.extra_config || '{}'),
  };
  const adapter = createAdapter(connection.db_type, config);
  return { connection, adapter };
}

async function fetchLiveTables(
  adapter: ReturnType<typeof createAdapter>,
): Promise<TableSnapshot[]> {
  const tables = await adapter.getTables();

  // Fetch columns + indexes for every table in parallel.
  // Oracle getColumns() does heavy PK/UK/FK JOINs — running them one-by-one
  // easily exceeds the 30 s client timeout on large schemas.
  const CONCURRENCY = 5;  // cap concurrent DB queries to avoid overwhelming the pool
  const results: (TableSnapshot | null)[] = new Array(tables.length);
  let cursor = 0;

  async function worker() {
    while (cursor < tables.length) {
      const i = cursor++;
      const t = tables[i];
      try {
        const [cols, idxs] = await Promise.all([
          adapter.getColumns(t.tableName),
          adapter.getIndexes(t.tableName),
        ]);
        results[i] = {
          table_name: t.tableName,
          table_comment: t.tableComment || '',
          engine: t.engine || '',
          row_count: t.rowCount || 0,
          columns: cols.map((c) => ({
            column_name: c.columnName,
            column_type: c.columnType,
            is_nullable: c.isNullable ? 'YES' : 'NO',
            column_key: c.columnKey || '',
            column_default: c.columnDefault ?? null,
            extra: c.extra || '',
            column_comment: c.columnComment || '',
            ordinal_position: c.ordinalPosition ?? 0,
          })),
          indexes: idxs.map((i) => ({
            index_name: i.indexName,
            index_type: i.indexType,
            columns: i.columns,
            is_unique: !!i.isUnique,
          })),
        };
      } catch (err: any) {
        // Don't fail the whole sync because of one broken table
        console.warn(`[sync] Skipping table ${t.tableName}: ${err.message}`);
        results[i] = null;
      }
    }
  }

  // Spin up CONCURRENCY parallel workers
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  return results.filter((r): r is TableSnapshot => r !== null);
}

async function fetchLiveProcedures(
  adapter: ReturnType<typeof createAdapter>,
): Promise<ProcedureSnapshot[]> {
  try {
    const procs = await adapter.getProcedures();
    return procs.map((p) => ({
      procedure_name: p.procedureName,
      procedure_type: p.procedureType,
      return_type: p.returnType,
      parameters: p.parameters,
      definition: p.definition,
      procedure_comment: p.procedureComment,
      last_modified: p.lastModified,
    }));
  } catch (err: any) {
    console.warn(`[sync] Failed to fetch procedures: ${err.message}`);
    return [];
  }
}

async function fetchLiveSnapshot(
  adapter: ReturnType<typeof createAdapter>,
): Promise<{ tables: TableSnapshot[]; procedures: ProcedureSnapshot[] }> {
  const [tables, procedures] = await Promise.all([
    fetchLiveTables(adapter),
    fetchLiveProcedures(adapter),
  ]);
  return { tables, procedures };
}

// ---------------------------------------------------------------------------
// Stored snapshot loading
// ---------------------------------------------------------------------------

async function loadStoredTables(versionId: number): Promise<TableSnapshot[]> {
  const tables = await knex('dictionary_tables').where({ version_id: versionId });
  if (tables.length === 0) return [];

  const tableIds = tables.map((t: any) => t.id);
  const [allCols, allIdxs] = await Promise.all([
    knex('dictionary_columns').whereIn('table_id', tableIds).orderBy('ordinal_position'),
    knex('dictionary_indexes').whereIn('table_id', tableIds),
  ]);

  const colsByTable = new Map<number, any[]>();
  for (const c of allCols) {
    if (!colsByTable.has(c.table_id)) colsByTable.set(c.table_id, []);
    colsByTable.get(c.table_id)!.push(c);
  }
  const idxsByTable = new Map<number, any[]>();
  for (const i of allIdxs) {
    if (!idxsByTable.has(i.table_id)) idxsByTable.set(i.table_id, []);
    idxsByTable.get(i.table_id)!.push(i);
  }

  return tables.map((t: any) => ({
    table_name: t.table_name,
    table_comment: t.table_comment || '',
    engine: t.engine || '',
    row_count: t.row_count || 0,
    columns: (colsByTable.get(t.id) || []).map((c: any) => ({
      column_name: c.column_name,
      column_type: c.column_type,
      is_nullable: c.is_nullable,
      column_key: c.column_key || '',
      column_default: c.column_default ?? null,
      extra: c.extra || '',
      column_comment: c.column_comment || '',
      ordinal_position: c.ordinal_position,
    })),
    indexes: (idxsByTable.get(t.id) || []).map((i: any) => ({
      index_name: i.index_name,
      index_type: i.index_type,
      columns: JSON.parse(i.columns || '[]'),
      is_unique: !!i.is_unique,
    })),
  }));
}

async function loadStoredProcedures(versionId: number): Promise<ProcedureSnapshot[]> {
  const rows = await knex('dictionary_procedures').where({ version_id: versionId });
  return rows.map((r: any) => ({
    procedure_name: r.procedure_name,
    procedure_type: r.procedure_type || 'PROCEDURE',
    return_type: r.return_type || '',
    parameters: JSON.parse(r.parameters || '[]'),
    definition: r.definition || '',
    procedure_comment: r.procedure_comment || '',
    last_modified: r.last_modified || '',
  }));
}

async function loadStoredSnapshot(
  versionId: number,
): Promise<{ tables: TableSnapshot[]; procedures: ProcedureSnapshot[] }> {
  const [tables, procedures] = await Promise.all([
    loadStoredTables(versionId),
    loadStoredProcedures(versionId),
  ]);
  return { tables, procedures };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function diffTables(prev: TableSnapshot[], next: TableSnapshot[]) {
  const prevMap = new Map(prev.map((t) => [t.table_name, t]));
  const nextMap = new Map(next.map((t) => [t.table_name, t]));

  const tables_added: TableSnapshot[] = [];
  const tables_removed: string[] = [];
  const tables_changed: TableDiff[] = [];

  for (const [name, t] of nextMap) {
    if (!prevMap.has(name)) tables_added.push(t);
  }
  for (const name of prevMap.keys()) {
    if (!nextMap.has(name)) tables_removed.push(name);
  }
  for (const [name, prevT] of prevMap) {
    const nextT = nextMap.get(name);
    if (!nextT) continue;
    const diff: TableDiff = {
      table_name: name,
      columns_added: [],
      columns_removed: [],
      columns_changed: [],
    };
    if (prevT.table_comment !== nextT.table_comment) {
      diff.comment_changed = { old: prevT.table_comment, new: nextT.table_comment };
    }
    const prevCols = new Map(prevT.columns.map((c) => [c.column_name, c]));
    const nextCols = new Map(nextT.columns.map((c) => [c.column_name, c]));
    for (const [cn, c] of nextCols) {
      if (!prevCols.has(cn)) diff.columns_added.push(c);
    }
    for (const cn of prevCols.keys()) {
      if (!nextCols.has(cn)) diff.columns_removed.push(cn);
    }
    for (const [cn, pC] of prevCols) {
      const nC = nextCols.get(cn);
      if (!nC) continue;
      const cd: ColumnDiff = { column_name: cn };
      if (pC.column_type !== nC.column_type) cd.type_changed = { old: pC.column_type, new: nC.column_type };
      if (pC.column_comment !== nC.column_comment) cd.comment_changed = { old: pC.column_comment, new: nC.column_comment };
      if (pC.is_nullable !== nC.is_nullable) cd.nullable_changed = { old: pC.is_nullable, new: nC.is_nullable };
      if ((pC.column_default ?? null) !== (nC.column_default ?? null)) {
        cd.default_changed = { old: pC.column_default ?? null, new: nC.column_default ?? null };
      }
      if (pC.column_key !== nC.column_key) cd.key_changed = { old: pC.column_key, new: nC.column_key };
      // Only report a change if at least one field differs
      if (Object.keys(cd).length > 1) diff.columns_changed.push(cd);
    }
    if (diff.comment_changed || diff.columns_added.length || diff.columns_removed.length || diff.columns_changed.length) {
      tables_changed.push(diff);
    }
  }

  return { tables_added, tables_removed, tables_changed };
}

function diffProcedures(prev: ProcedureSnapshot[], next: ProcedureSnapshot[]) {
  const prevMap = new Map(prev.map((p) => [p.procedure_name, p]));
  const nextMap = new Map(next.map((p) => [p.procedure_name, p]));

  const procedures_added: ProcedureSnapshot[] = [];
  const procedures_removed: string[] = [];
  const procedures_changed: ProcedureDiff[] = [];

  for (const [name, p] of nextMap) {
    if (!prevMap.has(name)) procedures_added.push(p);
  }
  for (const name of prevMap.keys()) {
    if (!nextMap.has(name)) procedures_removed.push(name);
  }
  for (const [name, pP] of prevMap) {
    const nP = nextMap.get(name);
    if (!nP) continue;
    const diff: ProcedureDiff = { procedure_name: name };
    if (pP.procedure_type !== nP.procedure_type) {
      diff.type_changed = { old: pP.procedure_type, new: nP.procedure_type };
    }
    if (pP.return_type !== nP.return_type) {
      diff.return_type_changed = { old: pP.return_type, new: nP.return_type };
    }
    const pParams = JSON.stringify(pP.parameters);
    const nParams = JSON.stringify(nP.parameters);
    if (pParams !== nParams) {
      diff.parameters_changed = { old: pParams, new: nParams };
    }
    if (pP.definition !== nP.definition) {
      diff.definition_changed = { old: pP.definition, new: nP.definition };
    }
    if (pP.procedure_comment !== nP.procedure_comment) {
      diff.comment_changed = { old: pP.procedure_comment, new: nP.procedure_comment };
    }
    if (Object.keys(diff).length > 1) procedures_changed.push(diff);
  }

  return { procedures_added, procedures_removed, procedures_changed };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export async function introspectAndDiff(connectionId: number): Promise<IntrospectionResult> {
  const { adapter } = await loadAdapter(connectionId);
  try {
    const ok = await adapter.testConnection();
    if (!ok) throw new Error('Cannot connect to database');

    const live = await fetchLiveSnapshot(adapter);

    const latestVersion = await knex('dictionary_versions')
      .where({ connection_id: connectionId })
      .orderBy('version_number', 'desc')
      .first();

    let prev: { tables: TableSnapshot[]; procedures: ProcedureSnapshot[] } = { tables: [], procedures: [] };
    if (latestVersion) {
      prev = await loadStoredSnapshot(latestVersion.id);
    }

    const tableDiff = diffTables(prev.tables, live.tables);
    const procDiff = diffProcedures(prev.procedures, live.procedures);

    return {
      latest_version: latestVersion
        ? { id: latestVersion.id, version_number: latestVersion.version_number, status: latestVersion.status }
        : null,
      tables_added: tableDiff.tables_added,
      tables_removed: tableDiff.tables_removed,
      tables_changed: tableDiff.tables_changed,
      procedures_added: procDiff.procedures_added,
      procedures_removed: procDiff.procedures_removed,
      procedures_changed: procDiff.procedures_changed,
      snapshot: { tables: live.tables, procedures: live.procedures },
    };
  } finally {
    await adapter.disconnect();
  }
}

/**
 * Apply a snapshot (either freshly introspected or supplied by the caller)
 * as a new draft version. Custom edits from the previous version are preserved
 * by table_name + column_name. `overrides` lets the caller seed
 * custom_comment / display_name / tags on freshly-added columns or procedures.
 *
 * Override key conventions:
 *   - `${table}.${column}` — columns
 *   - `procedure:${name}` — procedures
 */
export async function applySyncSnapshot(
  connectionId: number,
  snapshot: { tables: TableSnapshot[]; procedures?: ProcedureSnapshot[] },
  userId: number,
  overrides: Record<string, { custom_comment?: string; display_name?: string; tags?: string[] }> = {},
) {
  const latestVersion = await knex('dictionary_versions')
    .where({ connection_id: connectionId })
    .orderBy('version_number', 'desc')
    .first();
  const newVersionNumber = (latestVersion?.version_number || 0) + 1;

  // Load previous custom edits keyed by table_name + column_name.
  const prevEdits = new Map<string, {
    tableComment: string;
    columns: Map<string, { customComment: string; displayName: string; tags: string }>;
  }>();
  // Previous procedure custom_comment keyed by procedure_name.
  const prevProcEdits = new Map<string, string>();

  if (latestVersion) {
    const prevTables = await knex('dictionary_tables').where({ version_id: latestVersion.id });
    for (const pt of prevTables) {
      const prevColumns = await knex('dictionary_columns').where({ table_id: pt.id });
      const colMap = new Map<string, { customComment: string; displayName: string; tags: string }>();
      for (const pc of prevColumns) {
        colMap.set(pc.column_name, {
          customComment: pc.custom_comment || '',
          displayName: pc.display_name || '',
          tags: pc.tags || '[]',
        });
      }
      prevEdits.set(pt.table_name, { tableComment: pt.custom_comment || '', columns: colMap });
    }

    const prevProcs = await knex('dictionary_procedures').where({ version_id: latestVersion.id });
    for (const pp of prevProcs) {
      prevProcEdits.set(pp.procedure_name, pp.custom_comment || '');
    }
  }

  const tables_added = snapshot.tables.filter((t) => !prevEdits.has(t.table_name)).map((t) => t.table_name);
  const tables_removed = [...prevEdits.keys()].filter((n) => !snapshot.tables.find((t) => t.table_name === n));

  return await knex.transaction(async (trx) => {
    const [versionId] = await trx('dictionary_versions').insert({
      connection_id: connectionId,
      version_number: newVersionNumber,
      status: 'draft',
      created_by: userId,
      snapshot_data: JSON.stringify({
        tables_added,
        tables_removed,
        synced_at: new Date().toISOString(),
      }),
    });

    // --- Tables + columns + indexes ---
    for (const t of snapshot.tables) {
      const prevEdit = prevEdits.get(t.table_name);
      const [tableId] = await trx('dictionary_tables').insert({
        version_id: versionId,
        table_name: t.table_name,
        table_comment: t.table_comment,
        custom_comment: prevEdit?.tableComment || '',
        engine: t.engine,
        row_count: t.row_count,
      });

      for (const col of t.columns) {
        const prevCol = prevEdit?.columns.get(col.column_name);
        const overrideKey = `${t.table_name}.${col.column_name}`;
        const override = overrides[overrideKey];
        await trx('dictionary_columns').insert({
          table_id: tableId,
          column_name: col.column_name,
          column_type: col.column_type,
          is_nullable: col.is_nullable,
          column_key: col.column_key,
          column_default: col.column_default,
          extra: col.extra,
          column_comment: col.column_comment,
          custom_comment: override?.custom_comment ?? prevCol?.customComment ?? '',
          display_name: override?.display_name ?? prevCol?.displayName ?? '',
          tags: override?.tags ? JSON.stringify(override.tags) : (prevCol?.tags || '[]'),
          ordinal_position: col.ordinal_position ?? 0,
        });
      }

      for (const idx of t.indexes) {
        await trx('dictionary_indexes').insert({
          table_id: tableId,
          index_name: idx.index_name,
          index_type: idx.index_type,
          columns: JSON.stringify(idx.columns),
          is_unique: idx.is_unique ? 1 : 0,
        });
      }
    }

    // --- Procedures ---
    const procedures = snapshot.procedures || [];
    for (const p of procedures) {
      const override = overrides[`procedure:${p.procedure_name}`];
      const prevCustom = prevProcEdits.get(p.procedure_name);
      await trx('dictionary_procedures').insert({
        version_id: versionId,
        procedure_name: p.procedure_name,
        procedure_type: p.procedure_type,
        return_type: p.return_type,
        parameters: JSON.stringify(p.parameters),
        definition: p.definition,
        procedure_comment: p.procedure_comment,
        custom_comment: override?.custom_comment ?? prevCustom ?? '',
        last_modified: p.last_modified,
      });
    }

    return await trx('dictionary_versions').where({ id: versionId }).first();
  });
}

/**
 * Convenience: introspect + apply in one call. Equivalent to the legacy
 * single-step sync, kept for the existing /connections/:id/sync route.
 */
export async function syncConnection(connectionId: number, userId: number) {
  const intro = await introspectAndDiff(connectionId);
  return await applySyncSnapshot(connectionId, intro.snapshot, userId, {});
}

// ---------------------------------------------------------------------------
// Read-side helpers used by routes/dictionary.ts
// ---------------------------------------------------------------------------

export async function getDictionaryByConnection(connectionId: number, versionParam?: string | number) {
  let version;

  if (versionParam && versionParam !== 'latest') {
    version = await knex('dictionary_versions')
      .where({ connection_id: connectionId, version_number: Number(versionParam) })
      .first();
  } else {
    // Latest published, fallback to latest draft
    version = await knex('dictionary_versions')
      .where({ connection_id: connectionId, status: 'published' })
      .orderBy('version_number', 'desc')
      .first();
    if (!version) {
      version = await knex('dictionary_versions')
        .where({ connection_id: connectionId })
        .orderBy('version_number', 'desc')
        .first();
    }
  }

  if (!version) return { version: null, tables: [], procedures: [] };

  const tables = await knex('dictionary_tables').where({ version_id: version.id });
  const tableIds = tables.map((t: any) => t.id);

  // Batch-load columns + indexes in 2 queries instead of 2N
  let allColumns: any[] = [];
  let allIndexes: any[] = [];
  if (tableIds.length > 0) {
    [allColumns, allIndexes] = await Promise.all([
      knex('dictionary_columns').whereIn('table_id', tableIds).orderBy('ordinal_position'),
      knex('dictionary_indexes').whereIn('table_id', tableIds),
    ]);
  }

  const colsByTable = new Map<number, any[]>();
  for (const c of allColumns) {
    if (!colsByTable.has(c.table_id)) colsByTable.set(c.table_id, []);
    colsByTable.get(c.table_id)!.push(c);
  }
  const idxsByTable = new Map<number, any[]>();
  for (const i of allIndexes) {
    if (!idxsByTable.has(i.table_id)) idxsByTable.set(i.table_id, []);
    idxsByTable.get(i.table_id)!.push(i);
  }

  const tablesWithDetails = tables.map((table: any) => ({
    ...table,
    columns: (colsByTable.get(table.id) || []).map((c: any) => ({ ...c, tags: JSON.parse(c.tags || '[]') })),
    indexes: (idxsByTable.get(table.id) || []).map((i: any) => ({ ...i, columns: JSON.parse(i.columns || '[]') })),
  }));

  const procedures = await knex('dictionary_procedures')
    .where({ version_id: version.id })
    .orderBy('procedure_name', 'asc');

  return {
    version,
    tables: tablesWithDetails,
    procedures: procedures.map((p: any) => ({
      ...p,
      parameters: JSON.parse(p.parameters || '[]'),
    })),
  };
}