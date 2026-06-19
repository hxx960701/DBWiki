import knex from '../database/connection.js';

export async function publishVersion(versionId: number, userId: number, notes?: string) {
  const version = await knex('dictionary_versions').where({ id: versionId }).first();
  if (!version) throw new Error('Version not found');
  if (version.status !== 'draft') throw new Error('Only draft versions can be published');

  // Build snapshot
  const tables = await knex('dictionary_tables').where({ version_id: versionId });
  const snapshot = await Promise.all(
    tables.map(async (table) => {
      const columns = await knex('dictionary_columns').where({ table_id: table.id }).orderBy('ordinal_position');
      const indexes = await knex('dictionary_indexes').where({ table_id: table.id });
      return {
        tableName: table.table_name,
        tableComment: table.table_comment,
        customComment: table.custom_comment,
        engine: table.engine,
        rowCount: table.row_count,
        columns: columns.map(c => ({
          columnName: c.column_name,
          columnType: c.column_type,
          isNullable: c.is_nullable,
          columnKey: c.column_key,
          columnDefault: c.column_default,
          extra: c.extra,
          columnComment: c.column_comment,
          customComment: c.custom_comment,
          displayName: c.display_name,
          tags: JSON.parse(c.tags || '[]'),
        })),
        indexes: indexes.map(i => ({
          indexName: i.index_name,
          indexType: i.index_type,
          columns: JSON.parse(i.columns || '[]'),
          isUnique: i.is_unique === 1,
        })),
      };
    })
  );

  await knex('dictionary_versions').where({ id: versionId }).update({
    status: 'published',
    published_at: new Date().toISOString(),
    notes: notes || '',
    snapshot_data: JSON.stringify({
      tables: snapshot,
      generatedAt: new Date().toISOString(),
      tableCount: snapshot.length,
      columnCount: snapshot.reduce((acc, t) => acc + t.columns.length, 0),
    }),
  });

  return await knex('dictionary_versions').where({ id: versionId }).first();
}

export async function getVersions(connectionId: number) {
  const versions = await knex('dictionary_versions')
    .where({ connection_id: connectionId })
    .orderBy('version_number', 'desc');

  // Add counts
  return await Promise.all(
    versions.map(async (v) => {
      const tables = await knex('dictionary_tables').where({ version_id: v.id });
      let columnCount = 0;
      for (const t of tables) {
        const count = await knex('dictionary_columns').where({ table_id: t.id }).count('* as count').first();
        columnCount += (count as any)?.count || 0;
      }
      return { ...v, table_count: tables.length, column_count: columnCount };
    })
  );
}

export async function compareVersions(versionIdA: number, versionIdB: number) {
  const [vA, vB] = await Promise.all([
    knex('dictionary_versions').where({ id: versionIdA }).first(),
    knex('dictionary_versions').where({ id: versionIdB }).first(),
  ]);

  if (!vA || !vB) throw new Error('Version not found');

  const getTableMap = async (versionId: number) => {
    const tables = await knex('dictionary_tables').where({ version_id: versionId });
    const map = new Map<string, any>();
    for (const t of tables) {
      const columns = await knex('dictionary_columns').where({ table_id: t.id });
      map.set(t.table_name, { ...t, columns });
    }
    return map;
  };

  const mapA = await getTableMap(versionIdA);
  const mapB = await getTableMap(versionIdB);

  const added = [...mapB.keys()].filter(k => !mapA.has(k));
  const removed = [...mapA.keys()].filter(k => !mapB.has(k));
  const modified: any[] = [];

  for (const [name, tableB] of mapB) {
    if (!mapA.has(name)) continue;
    const tableA = mapA.get(name);
    const colMapA = new Map<string, any>(tableA.columns.map((c: any) => [c.column_name, c]));
    const colMapB = new Map<string, any>(tableB.columns.map((c: any) => [c.column_name, c]));

    const colsAdded = [...colMapB.keys()].filter(k => !colMapA.has(k));
    const colsRemoved = [...colMapA.keys()].filter(k => !colMapB.has(k));
    const colsModified: any[] = [];

    for (const [colName, colB] of colMapB) {
      if (!colMapA.has(colName)) continue;
      const colA = colMapA.get(colName);
      if (colA.column_type !== colB.column_type || colA.is_nullable !== colB.is_nullable) {
        colsModified.push({ name: colName, from: colA, to: colB });
      }
    }

    if (colsAdded.length || colsRemoved.length || colsModified.length) {
      modified.push({ tableName: name, colsAdded, colsRemoved, colsModified });
    }
  }

  return {
    versionA: { id: vA.id, version_number: vA.version_number },
    versionB: { id: vB.id, version_number: vB.version_number },
    tablesAdded: added,
    tablesRemoved: removed,
    tablesModified: modified,
  };
}

export async function rollbackToVersion(targetVersionId: number, userId: number) {
  const target = await knex('dictionary_versions').where({ id: targetVersionId }).first();
  if (!target || target.status !== 'published') throw new Error('Can only rollback to published versions');

  const snapshot = JSON.parse(target.snapshot_data || '{}');
  if (!snapshot.tables) throw new Error('No snapshot data');

  const latestVersion = await knex('dictionary_versions')
    .where({ connection_id: target.connection_id })
    .orderBy('version_number', 'desc')
    .first();

  const newVersionNumber = (latestVersion?.version_number || 0) + 1;

  return await knex.transaction(async (trx) => {
    const [versionId] = await trx('dictionary_versions').insert({
      connection_id: target.connection_id,
      version_number: newVersionNumber,
      status: 'draft',
      created_by: userId,
      notes: `Rollback from version ${target.version_number}`,
    });

    for (const table of snapshot.tables) {
      const [tableId] = await trx('dictionary_tables').insert({
        version_id: versionId,
        table_name: table.tableName,
        table_comment: table.tableComment,
        custom_comment: table.customComment || '',
        engine: table.engine || '',
        row_count: table.rowCount || 0,
      });

      for (const col of (table.columns || [])) {
        await trx('dictionary_columns').insert({
          table_id: tableId,
          column_name: col.columnName,
          column_type: col.columnType,
          is_nullable: col.isNullable ? 'YES' : 'NO',
          column_key: col.columnKey || '',
          column_default: col.columnDefault,
          extra: col.extra || '',
          column_comment: col.columnComment || '',
          custom_comment: col.customComment || '',
          display_name: col.displayName || '',
          tags: JSON.stringify(col.tags || []),
          ordinal_position: col.ordinalPosition || 0,
        });
      }

      for (const idx of (table.indexes || [])) {
        await trx('dictionary_indexes').insert({
          table_id: tableId,
          index_name: idx.indexName,
          index_type: idx.indexType || 'BTREE',
          columns: JSON.stringify(idx.columns || []),
          is_unique: idx.isUnique ? 1 : 0,
        });
      }
    }

    return await trx('dictionary_versions').where({ id: versionId }).first();
  });
}
