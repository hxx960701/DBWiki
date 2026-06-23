import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import knex from '../database/connection.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import { getProjectPermissions } from '../services/permissions.js';
import { exportToHTML, exportToExcel, exportToPDF } from '../services/export.js';
import { validate } from '../middleware/validate.js';

export const dictionaryRouter = Router();

dictionaryRouter.use(authenticate);

// ----- Helpers ---------------------------------------------------------------

async function ensureConnectionAccess(req: Request, connectionId: number, requiredPerm: string) {
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

async function ensureTableAccess(req: Request, tableId: number, requiredPerm: string) {
  const table = await knex('dictionary_tables').where({ id: tableId }).first();
  if (!table) throw new AppError('Table not found', 404);
  const version = await knex('dictionary_versions').where({ id: table.version_id }).first();
  if (!version) throw new AppError('Version not found', 404);
  await ensureConnectionAccess(req, version.connection_id, requiredPerm);
  return { table, version };
}

async function ensureColumnAccess(req: Request, columnId: number, requiredPerm: string) {
  const column = await knex('dictionary_columns').where({ id: columnId }).first();
  if (!column) throw new AppError('Column not found', 404);
  const { version } = await ensureTableAccess(req, column.table_id, requiredPerm);
  return { column, version };
}

async function ensureProcedureAccess(req: Request, procedureId: number, requiredPerm: string) {
  const procedure = await knex('dictionary_procedures').where({ id: procedureId }).first();
  if (!procedure) throw new AppError('Procedure not found', 404);
  const version = await knex('dictionary_versions').where({ id: procedure.version_id }).first();
  if (!version) throw new AppError('Version not found', 404);
  await ensureConnectionAccess(req, version.connection_id, requiredPerm);
  return { procedure, version };
}

// ----- Read -----------------------------------------------------------------

// GET /dictionary/connections/:id - get dictionary data for a connection
dictionaryRouter.get(
  '/connections/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectionId = parseInt(req.params.id as string, 10);
      const versionParam = req.query.version as string | undefined;

      const connection = await ensureConnectionAccess(req, connectionId, 'dictionary:read');

      let versionQuery = knex('dictionary_versions').where({ connection_id: connectionId });

      if (!versionParam || versionParam === 'latest') {
        // Default: show latest published version
        versionQuery = versionQuery.where({ status: 'published' }).orderBy('version_number', 'desc').limit(1);
      } else {
        const versionNumber = parseInt(versionParam, 10);
        if (isNaN(versionNumber)) {
          throw new AppError('Invalid version number', 400);
        }
        versionQuery = versionQuery.where({ version_number: versionNumber });
      }

      let version = await versionQuery.first();
      if (!version) {
        // No published version yet — fall back to any latest version (first sync / draft)
        version = await knex('dictionary_versions')
          .where({ connection_id: connectionId })
          .orderBy('version_number', 'desc')
          .first();
        if (!version) {
          throw new AppError('Version not found', 404);
        }
      }

      const tables = await knex('dictionary_tables')
        .where({ version_id: version.id })
        .orderBy('table_name', 'asc');

      const tablesWithDetails = await Promise.all(
        tables.map(async (table: any) => {
          const [columns, indexes] = await Promise.all([
            knex('dictionary_columns')
              .where({ table_id: table.id })
              .orderBy('ordinal_position', 'asc'),
            knex('dictionary_indexes')
              .where({ table_id: table.id })
              .orderBy('index_name', 'asc'),
          ]);

          return {
            ...table,
            columns: columns.map((c: any) => ({
              ...c,
              tags: JSON.parse(c.tags || '[]'),
            })),
            indexes: indexes.map((i: any) => ({
              ...i,
              columns: JSON.parse(i.columns || '[]'),
            })),
          };
        }),
      );

      const procedures = await knex('dictionary_procedures')
        .where({ version_id: version.id })
        .orderBy('procedure_name', 'asc');

      res.json({
        connection_id: connectionId,
        version,
        tables: tablesWithDetails,
        procedures: procedures.map((p: any) => ({
          ...p,
          parameters: JSON.parse(p.parameters || '[]'),
        })),
        connection_name: connection.name,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ----- Inline edit (kept for back-compat — UI now batches via /save) --------

dictionaryRouter.patch('/tables/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tableId = parseInt(req.params.id as string, 10);
    const { custom_comment } = req.body;
    if (custom_comment === undefined) throw new AppError('custom_comment is required', 400);

    const { version } = await ensureTableAccess(req, tableId, 'dictionary:edit');
    if (version.status === 'published') {
      throw new AppError('Cannot edit a published version', 400);
    }

    await knex('dictionary_tables')
      .where({ id: tableId })
      .update({ custom_comment, updated_at: knex.fn.now() });

    const updated = await knex('dictionary_tables').where({ id: tableId }).first();
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

dictionaryRouter.patch('/columns/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const columnId = parseInt(req.params.id as string, 10);
    const { custom_comment, display_name, tags } = req.body;
    const { version } = await ensureColumnAccess(req, columnId, 'dictionary:edit');
    if (version.status === 'published') {
      throw new AppError('Cannot edit a published version', 400);
    }
    const updateFields: Record<string, any> = {};
    if (custom_comment !== undefined) updateFields.custom_comment = custom_comment;
    if (display_name !== undefined) updateFields.display_name = display_name;
    if (tags !== undefined) updateFields.tags = JSON.stringify(tags);
    if (Object.keys(updateFields).length === 0) {
      throw new AppError('No update fields provided', 400);
    }
    await knex('dictionary_columns').where({ id: columnId }).update(updateFields);
    const updated = await knex('dictionary_columns').where({ id: columnId }).first();
    res.json({ ...updated, tags: JSON.parse(updated.tags || '[]') });
  } catch (error) {
    next(error);
  }
});

dictionaryRouter.patch('/procedures/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const procedureId = parseInt(req.params.id as string, 10);
    const { custom_comment } = req.body;
    if (custom_comment === undefined) throw new AppError('custom_comment is required', 400);

    const { version } = await ensureProcedureAccess(req, procedureId, 'dictionary:edit');
    if (version.status === 'published') {
      throw new AppError('Cannot edit a published version', 400);
    }

    await knex('dictionary_procedures')
      .where({ id: procedureId })
      .update({ custom_comment, updated_at: knex.fn.now() });

    const updated = await knex('dictionary_procedures').where({ id: procedureId }).first();
    res.json({ ...updated, parameters: JSON.parse(updated.parameters || '[]') });
  } catch (error) {
    next(error);
  }
});

// ----- Batch save -----------------------------------------------------------

const saveSchema = z.object({
  connection_id: z.number().int().positive(),
  // Optional version_id; if omitted we use the latest version on that connection.
  version_id: z.number().int().positive().optional(),
  table_changes: z.array(z.object({
    id: z.number().int().positive(),
    custom_comment: z.string().optional(),
  })).optional().default([]),
  column_changes: z.array(z.object({
    id: z.number().int().positive(),
    custom_comment: z.string().optional(),
    display_name: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })).optional().default([]),
  procedure_changes: z.array(z.object({
    id: z.number().int().positive(),
    custom_comment: z.string().optional(),
  })).optional().default([]),
});

/**
 * POST /dictionary/save
 *
 * Persist a batch of pending edits to the latest draft of a connection.
 *
 * If the latest version is `published`, the route forks a new draft
 * (next version_number, status='draft', cloned tables/columns/indexes/procedures)
 * and applies the edits to the fork. The edits' `id` values must be
 * column/table/procedure IDs from the version the user was viewing — we look them
 * up by name in the new draft.
 */
dictionaryRouter.post(
  '/save',
  validate(saveSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connection_id, version_id, table_changes, column_changes, procedure_changes } = req.body;
      const userId = req.user!.userId;

      const connection = await ensureConnectionAccess(req, connection_id, 'dictionary:save');

      // Resolve the current "working" version (the one the UI is editing).
      let workingVersion: any;
      if (version_id) {
        workingVersion = await knex('dictionary_versions').where({ id: version_id, connection_id }).first();
        if (!workingVersion) throw new AppError('Version not found', 404);
      } else {
        workingVersion = await knex('dictionary_versions')
          .where({ connection_id })
          .orderBy('version_number', 'desc')
          .first();
        if (!workingVersion) throw new AppError('No version exists for this connection. Sync first.', 400);
      }

      let targetVersion = workingVersion;
      let mappedTableChanges: Array<{ id: number; custom_comment?: string }> = table_changes;
      let mappedColumnChanges: Array<{ id: number; custom_comment?: string; display_name?: string; tags?: string[] }> = column_changes;
      let mappedProcedureChanges: Array<{ id: number; custom_comment?: string }> = procedure_changes;

      if (workingVersion.status === 'published') {
        const sourceTables = await knex('dictionary_tables').where({ version_id: workingVersion.id });
        const sourceColumns = await knex('dictionary_columns').whereIn('table_id', sourceTables.map((t: any) => t.id));
        const sourceProcedures = await knex('dictionary_procedures').where({ version_id: workingVersion.id });

        const nextVersionNumber = workingVersion.version_number + 1;
        const newDraft = await knex.transaction(async (trx) => {
          const [versionId] = await trx('dictionary_versions').insert({
            connection_id,
            version_number: nextVersionNumber,
            status: 'draft',
            snapshot_data: workingVersion.snapshot_data,
            created_by: userId,
            notes: `Forked from v${workingVersion.version_number}`,
          });

          // Map of source table_id → new table_id
          const tableIdMap = new Map<number, number>();
          for (const t of sourceTables) {
            const [newId] = await trx('dictionary_tables').insert({
              version_id: versionId,
              table_name: t.table_name,
              table_comment: t.table_comment,
              custom_comment: t.custom_comment,
              engine: t.engine,
              row_count: t.row_count,
            });
            tableIdMap.set(t.id, newId);
          }
          const columnIdMap = new Map<number, number>();
          for (const c of sourceColumns) {
            const newTableId = tableIdMap.get(c.table_id);
            if (!newTableId) continue;
            const [newId] = await trx('dictionary_columns').insert({
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
            columnIdMap.set(c.id, newId);
          }
          const sourceIndexes = await trx('dictionary_indexes').whereIn('table_id', sourceTables.map((t: any) => t.id));
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

          // Procedures
          const procedureIdMap = new Map<number, number>();
          for (const p of sourceProcedures) {
            const [newId] = await trx('dictionary_procedures').insert({
              version_id: versionId,
              procedure_name: p.procedure_name,
              procedure_type: p.procedure_type,
              return_type: p.return_type,
              parameters: p.parameters,
              definition: p.definition,
              procedure_comment: p.procedure_comment,
              custom_comment: p.custom_comment,
              last_modified: p.last_modified,
            });
            procedureIdMap.set(p.id, newId);
          }

          return {
            version: await trx('dictionary_versions').where({ id: versionId }).first(),
            tableIdMap,
            columnIdMap,
            procedureIdMap,
          };
        });

        targetVersion = newDraft.version;
        mappedTableChanges = table_changes
          .map((c: any) => ({ ...c, id: newDraft.tableIdMap.get(c.id) || 0 }))
          .filter((c: any) => c.id > 0);
        mappedColumnChanges = column_changes
          .map((c: any) => ({ ...c, id: newDraft.columnIdMap.get(c.id) || 0 }))
          .filter((c: any) => c.id > 0);
        mappedProcedureChanges = procedure_changes
          .map((c: any) => ({ ...c, id: newDraft.procedureIdMap.get(c.id) || 0 }))
          .filter((c: any) => c.id > 0);
      }

      // Apply changes to the target version (always a draft at this point).
      await knex.transaction(async (trx) => {
        for (const ch of mappedTableChanges) {
          const update: Record<string, any> = { updated_at: trx.fn.now() };
          if (ch.custom_comment !== undefined) update.custom_comment = ch.custom_comment;
          if (Object.keys(update).length > 1) {
            await trx('dictionary_tables').where({ id: ch.id, version_id: targetVersion.id }).update(update);
          }
        }
        for (const ch of mappedColumnChanges) {
          const update: Record<string, any> = {};
          if (ch.custom_comment !== undefined) update.custom_comment = ch.custom_comment;
          if (ch.display_name !== undefined) update.display_name = ch.display_name;
          if (ch.tags !== undefined) update.tags = JSON.stringify(ch.tags);
          if (Object.keys(update).length > 0) {
            // Verify the column belongs to this version (table.version_id == targetVersion.id).
            const col = await trx('dictionary_columns').where({ id: ch.id }).first();
            if (col) {
              const t = await trx('dictionary_tables').where({ id: col.table_id }).first();
              if (t && t.version_id === targetVersion.id) {
                await trx('dictionary_columns').where({ id: ch.id }).update(update);
              }
            }
          }
        }
        for (const ch of mappedProcedureChanges) {
          const update: Record<string, any> = { updated_at: trx.fn.now() };
          if (ch.custom_comment !== undefined) update.custom_comment = ch.custom_comment;
          if (Object.keys(update).length > 1) {
            await trx('dictionary_procedures').where({ id: ch.id, version_id: targetVersion.id }).update(update);
          }
        }
      });

      const refreshed = await knex('dictionary_versions').where({ id: targetVersion.id }).first();
      res.json({
        version: refreshed,
        applied: {
          tables: mappedTableChanges.length,
          columns: mappedColumnChanges.length,
          procedures: mappedProcedureChanges.length,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ----- Export ---------------------------------------------------------------

dictionaryRouter.get(
  '/export/:connectionId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectionId = parseInt(req.params.connectionId as string, 10);
      const format = ((req.query.format as string) || 'html').toLowerCase();
      const versionParam = req.query.version as string | undefined;

      const validFormats = ['html', 'pdf', 'excel'];
      if (!validFormats.includes(format)) {
        throw new AppError(`Invalid format. Must be one of: ${validFormats.join(', ')}`, 400);
      }

      const connection = await ensureConnectionAccess(req, connectionId, 'dictionary:read');

      // Resolve the version we'll export so we can include its number in the filename.
      let versionNumber: number | string = 'latest';
      if (versionParam && versionParam !== 'latest') {
        versionNumber = parseInt(versionParam, 10);
        if (isNaN(versionNumber as number)) {
          throw new AppError('Invalid version number', 400);
        }
      } else {
        const v = await knex('dictionary_versions')
          .where({ connection_id: connectionId })
          .orderBy('version_number', 'desc')
          .first();
        if (v) versionNumber = v.version_number;
      }

      const safeName = (connection.name || 'dictionary').replace(/[^a-zA-Z0-9._-]+/g, '_');
      const baseFilename = `dictionary_${safeName}_v${versionNumber}`;

      if (format === 'html') {
        const html = await exportToHTML(connectionId, versionParam);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.html"`);
        return res.send(html);
      }

      if (format === 'excel') {
        const buffer = await exportToExcel(connectionId, versionParam);
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.xlsx"`);
        return res.send(buffer);
      }

      if (format === 'pdf') {
        try {
          const buffer = await exportToPDF(connectionId, versionParam);
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.pdf"`);
          return res.send(buffer);
        } catch (err: any) {
          // PDF requires puppeteer (optional dep). Surface a helpful error.
          throw new AppError(
            err?.message || 'PDF export unavailable. Use HTML export as an alternative.',
            503,
          );
        }
      }
    } catch (error) {
      next(error);
    }
  },
);
