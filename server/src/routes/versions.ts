import { Router, Request, Response, NextFunction } from 'express';
import knex from '../database/connection.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import { getProjectPermissions } from '../services/permissions.js';
import type { DictionaryVersion } from '../types/index.js';

export const versionsRouter = Router();

versionsRouter.use(authenticate);

async function ensureProjectAccess(req: Request, connectionId: number, requiredPerm: string) {
  const connection = await knex('database_connections').where({ id: connectionId }).first();
  if (!connection) throw new AppError('Connection not found', 404);
  const userId = req.user!.userId;
  const isAdmin = req.user!.role === 'admin';
  if (!isAdmin) {
    const perms = await getProjectPermissions(userId, connection.project_id);
    if (!perms.includes(requiredPerm)) {
      throw new AppError('Insufficient permissions', 403);
    }
  }
  return connection;
}

// Reload all tables/columns/indexes for a version into a snapshot-shaped object,
// used for richer column-level comparisons that go beyond the JSON snapshot_data.
async function loadVersionFullSnapshot(versionId: number) {
  const tables = await knex('dictionary_tables').where({ version_id: versionId });
  const out = await Promise.all(
    tables.map(async (t: any) => {
      const columns = await knex('dictionary_columns').where({ table_id: t.id }).orderBy('ordinal_position');
      return {
        table_name: t.table_name,
        table_comment: t.table_comment || '',
        custom_comment: t.custom_comment || '',
        columns: columns.map((c: any) => ({
          column_name: c.column_name,
          column_type: c.column_type,
          is_nullable: c.is_nullable,
          column_key: c.column_key || '',
          column_default: c.column_default ?? null,
          column_comment: c.column_comment || '',
          custom_comment: c.custom_comment || '',
          display_name: c.display_name || '',
          tags: c.tags || '[]',
        })),
      };
    }),
  );
  return out;
}

async function loadVersionProcedures(versionId: number) {
  const rows = await knex('dictionary_procedures').where({ version_id: versionId });
  return rows.map((r: any) => ({
    procedure_name: r.procedure_name,
    procedure_type: r.procedure_type || 'PROCEDURE',
    return_type: r.return_type || '',
    parameters: r.parameters || '[]',
    definition: r.definition || '',
    procedure_comment: r.procedure_comment || '',
    custom_comment: r.custom_comment || '',
  }));
}

// GET /dictionary/versions/compare?a=&b=
versionsRouter.get('/compare', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const versionIdA = parseInt(req.query.a as string, 10);
    const versionIdB = parseInt(req.query.b as string, 10);

    if (!versionIdA || !versionIdB) {
      throw new AppError('Both version IDs are required (query params: a, b)', 400);
    }

    const [versionA, versionB] = await Promise.all([
      knex('dictionary_versions').where({ id: versionIdA }).first() as Promise<DictionaryVersion | undefined>,
      knex('dictionary_versions').where({ id: versionIdB }).first() as Promise<DictionaryVersion | undefined>,
    ]);

    if (!versionA) throw new AppError('Version A not found', 404);
    if (!versionB) throw new AppError('Version B not found', 404);

    await ensureProjectAccess(req, versionA.connection_id, 'dictionary:read');

    const tablesA = await loadVersionFullSnapshot(versionA.id);
    const tablesB = await loadVersionFullSnapshot(versionB.id);
    const proceduresA = await loadVersionProcedures(versionA.id);
    const proceduresB = await loadVersionProcedures(versionB.id);

    const mapA = new Map(tablesA.map((t) => [t.table_name, t]));
    const mapB = new Map(tablesB.map((t) => [t.table_name, t]));

    const added: string[] = [];
    const removed: string[] = [];
    const changed: Array<{
      table_name: string;
      table_comment_changed?: { old: string; new: string };
      custom_comment_changed?: { old: string; new: string };
      columns: Array<Record<string, any>>;
    }> = [];

    for (const name of mapB.keys()) if (!mapA.has(name)) added.push(name);
    for (const name of mapA.keys()) if (!mapB.has(name)) removed.push(name);

    for (const [name, tA] of mapA.entries()) {
      const tB = mapB.get(name);
      if (!tB) continue;
      const tableEntry: any = { table_name: name, columns: [] as any[] };
      if (tA.table_comment !== tB.table_comment) {
        tableEntry.table_comment_changed = { old: tA.table_comment, new: tB.table_comment };
      }
      if (tA.custom_comment !== tB.custom_comment) {
        tableEntry.custom_comment_changed = { old: tA.custom_comment, new: tB.custom_comment };
      }
      const colsA = new Map(tA.columns.map((c) => [c.column_name, c]));
      const colsB = new Map(tB.columns.map((c) => [c.column_name, c]));

      for (const [cn, c] of colsB) {
        if (!colsA.has(cn)) {
          tableEntry.columns.push({ change: 'added', column_name: cn, new: c });
        }
      }
      for (const [cn, c] of colsA) {
        if (!colsB.has(cn)) {
          tableEntry.columns.push({ change: 'removed', column_name: cn, old: c });
        }
      }
      for (const [cn, cA] of colsA) {
        const cB = colsB.get(cn);
        if (!cB) continue;
        const fields: Record<string, { old: any; new: any }> = {};
        const compare = (key: keyof typeof cA) => {
          if ((cA as any)[key] !== (cB as any)[key]) {
            fields[key as string] = { old: (cA as any)[key], new: (cB as any)[key] };
          }
        };
        compare('column_type');
        compare('column_comment');
        compare('custom_comment');
        compare('display_name');
        compare('is_nullable');
        compare('column_default');
        compare('column_key');
        compare('tags');
        if (Object.keys(fields).length > 0) {
          tableEntry.columns.push({ change: 'modified', column_name: cn, fields });
        }
      }
      if (
        tableEntry.table_comment_changed
        || tableEntry.custom_comment_changed
        || tableEntry.columns.length > 0
      ) {
        changed.push(tableEntry);
      }
    }

    // --- Procedure diff ---
    const procMapA = new Map(proceduresA.map((p: any) => [p.procedure_name, p]));
    const procMapB = new Map(proceduresB.map((p: any) => [p.procedure_name, p]));
    const procAdded: string[] = [];
    const procRemoved: string[] = [];
    const procChanged: Array<Record<string, any>> = [];

    for (const name of procMapB.keys()) if (!procMapA.has(name)) procAdded.push(name);
    for (const name of procMapA.keys()) if (!procMapB.has(name)) procRemoved.push(name);
    for (const [name, pA] of procMapA.entries()) {
      const pB = procMapB.get(name);
      if (!pB) continue;
      const fields: Record<string, { old: any; new: any }> = {};
      const compareKeys = ['procedure_type', 'return_type', 'parameters', 'definition', 'procedure_comment', 'custom_comment'];
      for (const key of compareKeys) {
        if ((pA as any)[key] !== (pB as any)[key]) {
          fields[key] = { old: (pA as any)[key], new: (pB as any)[key] };
        }
      }
      if (Object.keys(fields).length > 0) {
        procChanged.push({ procedure_name: name, fields });
      }
    }

    res.json({
      version_a: { id: versionA.id, version_number: versionA.version_number, status: versionA.status },
      version_b: { id: versionB.id, version_number: versionB.version_number, status: versionB.status },
      diff: { added, removed, changed },
      procedures: { added: procAdded, removed: procRemoved, changed: procChanged },
    });
  } catch (error) {
    next(error);
  }
});

// GET /dictionary/versions/drafts — list current user's own drafts
versionsRouter.get('/drafts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const drafts = await knex('dictionary_versions as v')
      .join('database_connections as dc', 'dc.id', 'v.connection_id')
      .select(
        'v.id',
        'v.connection_id',
        'v.version_number',
        'v.status',
        'v.created_by',
        'v.created_at',
        'v.notes',
        'dc.database_name as connection_name',
      )
      .where({ 'v.status': 'draft', 'v.created_by': userId })
      .orderBy('v.created_at', 'desc');
    res.json(drafts);
  } catch (error) {
    next(error);
  }
});

// GET /dictionary/versions/:connectionId — list versions
versionsRouter.get('/:connectionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connectionId = parseInt(req.params.connectionId as string, 10);
    await ensureProjectAccess(req, connectionId, 'dictionary:read');

    const versions = await knex('dictionary_versions as v')
      .leftJoin('users as u', 'u.id', 'v.created_by')
      .select(
        'v.id',
        'v.connection_id',
        'v.version_number',
        'v.status',
        'v.created_by',
        'v.created_at',
        'v.published_at',
        'v.notes',
        'u.username as created_by_username',
      )
      .where('v.connection_id', connectionId)
      .orderBy('v.version_number', 'desc');

    res.json(versions);
  } catch (error) {
    next(error);
  }
});

// GET /dictionary/versions/connection/:connectionId/publish-logs — full publish history
versionsRouter.get(
  '/connection/:connectionId/publish-logs',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectionId = parseInt(req.params.connectionId as string, 10);
      await ensureProjectAccess(req, connectionId, 'dictionary:read');

      const logs = await knex('dictionary_publish_logs as pl')
        .join('dictionary_versions as v', 'v.id', 'pl.version_id')
        .leftJoin('users as u', 'u.id', 'pl.published_by')
        .where('v.connection_id', connectionId)
        .select(
          'pl.id',
          'pl.version_id',
          'v.version_number',
          'pl.published_by',
          'u.username as published_by_username',
          'pl.published_at',
          'pl.notes',
        )
        .orderBy('pl.published_at', 'desc');

      res.json(logs);
    } catch (error) {
      next(error);
    }
  },
);

// GET /dictionary/versions/:id/publish-log — log for a single version
versionsRouter.get(
  '/:id/publish-log',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const versionId = parseInt(req.params.id as string, 10);
      const version = await knex('dictionary_versions').where({ id: versionId }).first();
      if (!version) throw new AppError('Version not found', 404);
      await ensureProjectAccess(req, version.connection_id, 'dictionary:read');

      const logs = await knex('dictionary_publish_logs as pl')
        .leftJoin('users as u', 'u.id', 'pl.published_by')
        .where('pl.version_id', versionId)
        .select('pl.id', 'pl.version_id', 'pl.published_by', 'u.username as published_by_username', 'pl.published_at', 'pl.notes')
        .orderBy('pl.published_at', 'desc');
      res.json(logs);
    } catch (error) {
      next(error);
    }
  },
);

// POST /dictionary/versions/:connectionId — manual snapshot (clone latest as new draft)
versionsRouter.post('/:connectionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connectionId = parseInt(req.params.connectionId as string, 10);
    await ensureProjectAccess(req, connectionId, 'dictionary:save');

    const latestVersion = await knex('dictionary_versions')
      .where({ connection_id: connectionId })
      .max('version_number as max_version')
      .first();
    const nextVersionNumber = Number((latestVersion as any)?.max_version ?? 0) + 1;

    const latestPublished = await knex('dictionary_versions')
      .where({ connection_id: connectionId, status: 'published' })
      .orderBy('version_number', 'desc')
      .first();

    let snapshotData: any = { tables: [] };
    if (latestPublished && latestPublished.snapshot_data) {
      snapshotData = JSON.parse(latestPublished.snapshot_data);
    } else {
      const latestExisting = await knex('dictionary_versions')
        .where({ connection_id: connectionId })
        .orderBy('version_number', 'desc')
        .first();
      if (latestExisting) {
        const tables = await knex('dictionary_tables').where({ version_id: latestExisting.id });
        snapshotData.tables = await Promise.all(
          tables.map(async (table: any) => {
            const [columns, indexes] = await Promise.all([
              knex('dictionary_columns').where({ table_id: table.id }),
              knex('dictionary_indexes').where({ table_id: table.id }),
            ]);
            return { ...table, columns, indexes };
          }),
        );
        // For simplicity, procedures are referenced via dictionary_procedures
        // so we don't embed them in snapshot_data (they live in the separate table).
      }
    }

    const [id] = await knex('dictionary_versions').insert({
      connection_id: connectionId,
      version_number: nextVersionNumber,
      status: 'draft',
      snapshot_data: JSON.stringify(snapshotData),
      created_by: req.user!.userId,
      notes: req.body.notes || '',
    });

    const version = await knex('dictionary_versions').where({ id }).first();
    res.status(201).json(version);
  } catch (error) {
    next(error);
  }
});

// POST /dictionary/versions/:id/publish
versionsRouter.post('/:id/publish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const versionId = parseInt(req.params.id as string, 10);

    const version = await knex('dictionary_versions').where({ id: versionId }).first() as DictionaryVersion | undefined;
    if (!version) throw new AppError('Version not found', 404);
    if (version.status !== 'draft') throw new AppError('Only draft versions can be published', 400);

    await ensureProjectAccess(req, version.connection_id, 'dictionary:publish');

    // Stale check: if the draft was created before the latest published version,
    // warn the user that the draft may be based on outdated structure.
    if (!req.body.force) {
      const latestPublished = await knex('dictionary_versions')
        .where({ connection_id: version.connection_id, status: 'published' })
        .orderBy('version_number', 'desc')
        .first() as DictionaryVersion | undefined;

      if (latestPublished && version.created_at < latestPublished.created_at) {
        res.json({
          stale: true,
          message: `当前草稿创建于 ${version.created_at}，最新发布版 v${latestPublished.version_number} 创建于 ${latestPublished.created_at}。草稿可能基于旧结构，确认发布吗？`,
          latestVersion: { id: latestPublished.id, version_number: latestPublished.version_number, created_at: latestPublished.created_at },
          draftCreatedAt: version.created_at,
        });
        return;
      }
    }

    const notes: string = (req.body.notes ?? version.notes ?? '').toString();

    // Ensure the published version_number is always higher than any existing version.
    // If the draft was created before a higher-numbered version was published,
    // bump its version_number to max+1.
    let publishVersionNumber = version.version_number;
    const maxVersion = await knex('dictionary_versions')
      .where({ connection_id: version.connection_id })
      .max('version_number as max_version')
      .first() as any;
    const maxExisting = Number(maxVersion?.max_version ?? 0);
    if (publishVersionNumber <= maxExisting) {
      publishVersionNumber = maxExisting + 1;
    }

    await knex.transaction(async (trx) => {
      await trx('dictionary_versions').where({ id: versionId }).update({
        status: 'published',
        version_number: publishVersionNumber,
        published_at: trx.fn.now(),
        notes,
      });
      await trx('dictionary_publish_logs').insert({
        version_id: versionId,
        published_by: req.user!.userId,
        notes,
      });
    });

    const updated = await knex('dictionary_versions').where({ id: versionId }).first();
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /dictionary/versions/:id — admin only.
 *
 * Cascades through FK constraints (the dictionary_tables/columns/indexes/publish_logs
 * tables should have ON DELETE CASCADE on their version_id FK). Transactions the
 * delete so a partial failure leaves no orphan rows.
 *
 * Admin gate: `role === 'admin'` (the system-level admin) OR a user holding the
 * `user:manage` global permission (i.e. someone who is effectively a system admin
 * via RBAC). This mirrors the pattern used elsewhere in the admin route family.
 */
versionsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const isSystemAdmin = user.role === 'admin';
    const hasAdminPerm = (user.permissions || []).includes('user:manage');

    const versionId = parseInt(req.params.id as string, 10);
    const version = await knex('dictionary_versions').where({ id: versionId }).first() as DictionaryVersion | undefined;
    if (!version) throw new AppError('Version not found', 404);

    // Allow: admins OR the owner of a draft
    const isOwnDraft = version.status === 'draft' && version.created_by === user.userId;
    if (!isSystemAdmin && !hasAdminPerm && !isOwnDraft) {
      throw new AppError('Only administrators or the draft owner can delete versions', 403);
    }

    await knex.transaction(async (trx) => {
      // Defensive child cleanup: even if FK cascades aren't in place, do it
      // explicitly so we never leave orphan rows. publish_logs is not strictly
      // required to be removed (audit history), but removing it keeps the
      // table count consistent with the version.
      const tableRows: Array<{ id: number }> = await trx('dictionary_tables')
        .where({ version_id: versionId })
        .select('id');
      const tableIds = tableRows.map((t) => t.id);

      if (tableIds.length > 0) {
        await trx('dictionary_columns').whereIn('table_id', tableIds).del();
        await trx('dictionary_indexes').whereIn('table_id', tableIds).del();
      }
      await trx('dictionary_procedures').where({ version_id: versionId }).del();
      await trx('dictionary_tables').where({ version_id: versionId }).del();
      await trx('dictionary_publish_logs').where({ version_id: versionId }).del();
      await trx('dictionary_versions').where({ id: versionId }).del();
    });

    res.json({ success: true, deleted_version_id: versionId });
  } catch (error) {
    next(error);
  }
});

// POST /dictionary/versions/:id/rollback — fork a published version to a new draft
versionsRouter.post('/:id/rollback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const versionId = parseInt(req.params.id as string, 10);

    const version = await knex('dictionary_versions').where({ id: versionId }).first() as DictionaryVersion | undefined;
    if (!version) throw new AppError('Version not found', 404);
    if (version.status !== 'published') throw new AppError('Only published versions can be rolled back to', 400);

    await ensureProjectAccess(req, version.connection_id, 'dictionary:save');

    // Determine next version number
    const latestVersion = await knex('dictionary_versions')
      .where({ connection_id: version.connection_id })
      .max('version_number as max_version')
      .first();
    const nextVersionNumber = Number((latestVersion as any)?.max_version ?? 0) + 1;

    // Clone tables/columns/indexes into the new draft.
    const sourceTables = await knex('dictionary_tables').where({ version_id: version.id });
    const sourceColumns = await knex('dictionary_columns').whereIn('table_id', sourceTables.map((t: any) => t.id));
    const sourceIndexes = await knex('dictionary_indexes').whereIn('table_id', sourceTables.map((t: any) => t.id));
    const sourceProcedures = await knex('dictionary_procedures').where({ version_id: version.id });

    const newVersion = await knex.transaction(async (trx) => {
      const [id] = await trx('dictionary_versions').insert({
        connection_id: version.connection_id,
        version_number: nextVersionNumber,
        status: 'draft',
        snapshot_data: version.snapshot_data,
        created_by: req.user!.userId,
        notes: `Rollback from version ${version.version_number}`,
      });
      const tableIdMap = new Map<number, number>();
      for (const t of sourceTables) {
        const [newTableId] = await trx('dictionary_tables').insert({
          version_id: id,
          table_name: t.table_name,
          table_comment: t.table_comment,
          custom_comment: t.custom_comment,
          engine: t.engine,
          row_count: t.row_count,
        });
        tableIdMap.set(t.id, newTableId);
      }
      for (const c of sourceColumns) {
        const newTableId = tableIdMap.get(c.table_id);
        if (!newTableId) continue;
        await trx('dictionary_columns').insert({
          table_id: newTableId,
          column_name: c.column_name,
          column_type: c.column_type,
          is_nullable: c.is_nullable,
          column_key: c.column_key,
          column_default: c.column_default,
          extra: c.extra,
          column_comment: c.column_comment,
          custom_comment: c.custom_comment,
          display_name: c.display_name,
          tags: c.tags,
          ordinal_position: c.ordinal_position,
        });
      }
      for (const idx of sourceIndexes) {
        const newTableId = tableIdMap.get(idx.table_id);
        if (!newTableId) continue;
        await trx('dictionary_indexes').insert({
          table_id: newTableId,
          index_name: idx.index_name,
          index_type: idx.index_type,
          columns: idx.columns,
          is_unique: idx.is_unique,
        });
      }
      for (const p of sourceProcedures) {
        await trx('dictionary_procedures').insert({
          version_id: id,
          procedure_name: p.procedure_name,
          procedure_type: p.procedure_type,
          return_type: p.return_type,
          parameters: p.parameters,
          definition: p.definition,
          procedure_comment: p.procedure_comment,
          custom_comment: p.custom_comment,
          last_modified: p.last_modified,
        });
      }
      return await trx('dictionary_versions').where({ id }).first();
    });

    res.status(201).json(newVersion);
  } catch (error) {
    next(error);
  }
});
