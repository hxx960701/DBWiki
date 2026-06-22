import knex from '../database/connection.js';
import { decrypt } from './encryption.js';
import { createAdapter } from '../adapters/factory.js';
import type { ConnectionConfig } from '../adapters/types.js';

/**
 * Introspection / sync pipeline, broken into two phases so the UI can offer
 * a "preview the diff before applying" flow:
 *
 *   1. introspectAndDiff(connectionId) — connect to the live database, fetch
 *      tables/columns/indexes, compare against the latest stored version
 *      (draft or published), and return a structured diff plus the full new
 *      snapshot. Does NOT write anything.
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

export interface IntrospectionResult {
  latest_version: { id: number; version_number: number; status: string } | null;
  tables_added: TableSnapshot[];
  tables_removed: string[];
  tables_changed: TableDiff[];
  // Full snapshot of the live database. Pass back to /sync/apply unchanged.
  snapshot: { tables: TableSnapshot[] };
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

async function fetchLiveSnapshot(adapter: ReturnType<typeof createAdapter>): Promise<TableSnapshot[]> {
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
            ordinal_position: c.ordinalPosition,
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

async function loadStoredSnapshot(versionId: number): Promise<TableSnapshot[]> {
  const tables = await knex('dictionary_tables').where({ version_id: versionId });
  const out: TableSnapshot[] = [];
  for (const t of tables) {
    const cols = await knex('dictionary_columns').where({ table_id: t.id }).orderBy('ordinal_position');
    const idxs = await knex('dictionary_indexes').where({ table_id: t.id });
    out.push({
      table_name: t.table_name,
      table_comment: t.table_comment || '',
      engine: t.engine || '',
      row_count: t.row_count || 0,
      columns: cols.map((c: any) => ({
        column_name: c.column_name,
        column_type: c.column_type,
        is_nullable: c.is_nullable,
        column_key: c.column_key || '',
        column_default: c.column_default ?? null,
        extra: c.extra || '',
        column_comment: c.column_comment || '',
        ordinal_position: c.ordinal_position,
      })),
      indexes: idxs.map((i: any) => ({
        index_name: i.index_name,
        index_type: i.index_type,
        columns: JSON.parse(i.columns || '[]'),
        is_unique: !!i.is_unique,
      })),
    });
  }
  return out;
}

function diffSnapshots(prev: TableSnapshot[], next: TableSnapshot[]) {
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

export async function introspectAndDiff(connectionId: number): Promise<IntrospectionResult> {
  const { adapter } = await loadAdapter(connectionId);
  try {
    const ok = await adapter.testConnection();
    if (!ok) throw new Error('Cannot connect to database');

    const liveTables = await fetchLiveSnapshot(adapter);

    const latestVersion = await knex('dictionary_versions')
      .where({ connection_id: connectionId })
      .orderBy('version_number', 'desc')
      .first();

    let prevTables: TableSnapshot[] = [];
    if (latestVersion) {
      prevTables = await loadStoredSnapshot(latestVersion.id);
    }

    const diff = diffSnapshots(prevTables, liveTables);
    return {
      latest_version: latestVersion
        ? { id: latestVersion.id, version_number: latestVersion.version_number, status: latestVersion.status }
        : null,
      tables_added: diff.tables_added,
      tables_removed: diff.tables_removed,
      tables_changed: diff.tables_changed,
      snapshot: { tables: liveTables },
    };
  } finally {
    await adapter.disconnect();
  }
}

/**
 * Apply a snapshot (either freshly introspected or supplied by the caller)
 * as a new draft version. Custom edits from the previous version are preserved
 * by table_name + column_name. `overrides[table.column]` lets the caller seed
 * custom_comment / display_name / tags on freshly-added columns.
 */
export async function applySyncSnapshot(
  connectionId: number,
  snapshot: { tables: TableSnapshot[] },
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
          ordinal_position: col.ordinal_position,
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

  if (!version) return { version: null, tables: [] };

  const tables = await knex('dictionary_tables').where({ version_id: version.id });
  const tablesWithDetails = await Promise.all(
    tables.map(async (table) => {
      const columns = await knex('dictionary_columns')
        .where({ table_id: table.id })
        .orderBy('ordinal_position');
      const indexes = await knex('dictionary_indexes').where({ table_id: table.id });
      return {
        ...table,
        columns: columns.map((c: any) => ({ ...c, tags: JSON.parse(c.tags || '[]') })),
        indexes: indexes.map((i: any) => ({ ...i, columns: JSON.parse(i.columns || '[]') })),
      };
    }),
  );

  return { version, tables: tablesWithDetails };
}
