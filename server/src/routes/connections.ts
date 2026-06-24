import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import knex from '../database/connection.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/error-handler.js';
import { decrypt } from '../services/encryption.js';
import { createAdapter } from '../adapters/factory.js';
import { introspectAndDiff, applySyncSnapshot, syncConnection } from '../services/dictionary.js';
import { getGlobalPermissions, getProjectPermissions } from '../services/permissions.js';
import { recordAuditAsync } from '../services/audit-log.js';
import type { DatabaseConnection } from '../types/index.js';

export const connectionActionsRouter = Router();

// All connection action routes require authentication
connectionActionsRouter.use(authenticate);

const testConnectionSchema = z.object({
  db_type: z.enum(['mysql', 'postgresql', 'mssql', 'oracle', 'starrocks', 'clickhouse', 'influxdb']),
  host: z.string().min(1),
  port: z.number().int().positive(),
  database_name: z.string().min(1),
  username: z.string().optional().default(''),
  password: z.string().optional().default(''),
  extra_config: z.union([z.string(), z.record(z.any())]).optional(),
});

/**
 * POST /connections/test
 *
 * Test an arbitrary connection config without saving it. Used by the
 * connection-edit modal so users can validate credentials before clicking save.
 *
 * Authorization: any user with connection:manage on at least one project may
 * call this. We don't tie it to a specific project — there might not be one
 * yet (e.g. preparing a new connection in a fresh project).
 */
connectionActionsRouter.post(
  '/test',
  validate(testConnectionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Permission gate: must hold connection:manage globally OR on any project.
      const userId = req.user!.userId;
      const isAdmin = req.user!.role === 'admin';
      let allowed = isAdmin;
      if (!allowed) {
        const globals = await getGlobalPermissions(userId);
        if (globals.includes('connection:manage')) {
          allowed = true;
        } else {
          // Fallback: any project where the user has connection:manage.
          const memberProjects = await knex('project_members').where({ user_id: userId }).pluck('project_id');
          for (const pid of memberProjects) {
            const perms = await getProjectPermissions(userId, pid);
            if (perms.includes('connection:manage')) {
              allowed = true;
              break;
            }
          }
        }
      }
      if (!allowed) {
        throw new AppError('Insufficient permissions', 403);
      }

      const { db_type, host, port, database_name, username, password, extra_config } = req.body;
      const extra = typeof extra_config === 'string'
        ? (extra_config ? JSON.parse(extra_config) : {})
        : (extra_config || {});

      const adapter = createAdapter(db_type, {
        host,
        port,
        database: database_name,
        username,
        password,
        extraConfig: extra,
      });

      const start = Date.now();
      let success = false;
      let message = 'Connection successful';
      try {
        success = await adapter.testConnection();
        if (!success) message = 'Connection failed';
      } catch (err: any) {
        success = false;
        message = err?.message || 'Connection failed';
      } finally {
        try { await adapter.disconnect(); } catch { /* noop */ }
      }
      const latency_ms = success ? Date.now() - start : 0;

      res.json({ success, message, latency_ms });
    } catch (error) {
      next(error);
    }
  },
);

// Helper: load a connection and verify access via project permission.
async function loadAuthorizedConnection(req: Request, requiredPerm: string): Promise<DatabaseConnection> {
  const connectionId = parseInt(req.params.id as string, 10);
  const connection = await knex('database_connections').where({ id: connectionId }).first() as DatabaseConnection | undefined;
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

// GET /connections/:id/info — lightweight connection + project name for breadcrumbs
connectionActionsRouter.get(
  '/:id/info',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connection = await loadAuthorizedConnection(req, 'dictionary:read');
      const project = await knex('projects').where({ id: connection.project_id }).select('name').first();
      res.json({
        connection_name: connection.name,
        project_name: (project as any)?.name || '',
      });
    } catch (error) {
      next(error);
    }
  },
);

// POST /connections/:id/preview - test an existing saved connection
connectionActionsRouter.post(
  '/:id/preview',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connection = await loadAuthorizedConnection(req, 'connection:manage');

      const password = decrypt(connection.encrypted_password);
      const adapter = createAdapter(connection.db_type, {
        host: connection.host,
        port: connection.port,
        database: connection.database_name,
        username: connection.username,
        password,
        extraConfig: connection.extra_config ? JSON.parse(connection.extra_config) : {},
      });

      const start = Date.now();
      let success = false;
      let message = 'Connection successful';
      try {
        success = await adapter.testConnection();
        if (!success) message = 'Connection failed';
      } catch (err: any) {
        success = false;
        message = err?.message || 'Connection failed';
      } finally {
        try { await adapter.disconnect(); } catch { /* noop */ }
      }
      const latency_ms = success ? Date.now() - start : 0;

      res.json({ success, message, latency_ms });
    } catch (error: any) {
      if (error instanceof AppError) {
        return next(error);
      }
      res.json({
        success: false,
        message: error.message || 'Connection failed',
        latency_ms: 0,
      });
    }
  },
);

// POST /connections/:id/sync - sync (introspect + apply) in one shot
connectionActionsRouter.post(
  '/:id/sync',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connection = await loadAuthorizedConnection(req, 'connection:sync');
      const startedAt = Date.now();
      const version = await syncConnection(connection.id, req.user!.userId);
      recordAuditAsync({
        category: 'sync',
        action: 'sync.full',
        req,
        result: 'success',
        target: { type: 'connection', id: connection.id, label: connection.name },
        metadata: {
          duration_ms: Date.now() - startedAt,
          version_id: version?.id,
          version_number: version?.version_number,
        },
      });
      res.json(version);
    } catch (error) {
      next(error);
    }
  },
);

// POST /connections/:id/preview-sync - introspect the database and return a
// structured diff vs the latest stored version. Does NOT write anything.
connectionActionsRouter.post(
  '/:id/preview-sync',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connection = await loadAuthorizedConnection(req, 'connection:sync');
      const startedAt = Date.now();
      const result = await introspectAndDiff(connection.id);
      recordAuditAsync({
        category: 'sync',
        action: 'sync.preview',
        req,
        result: 'success',
        target: { type: 'connection', id: connection.id, label: connection.name },
        metadata: {
          duration_ms: Date.now() - startedAt,
          tables_added: result.tables_added?.length || 0,
          tables_removed: result.tables_removed?.length || 0,
          tables_changed: result.tables_changed?.length || 0,
          procedures_added: result.procedures_added?.length || 0,
          procedures_removed: result.procedures_removed?.length || 0,
          procedures_changed: result.procedures_changed?.length || 0,
        },
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// POST /connections/:id/sync/apply - apply a previously-previewed snapshot
// (with optional per-column user overrides) as a new draft version.
const applyOverridesSchema = z.object({
  // The full snapshot returned from /preview-sync. We trust its shape.
  snapshot: z.any(),
  // User-provided initial custom_comment / display_name / tags keyed by table.column.
  overrides: z.record(z.object({
    custom_comment: z.string().optional(),
    display_name: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })).optional(),
});

connectionActionsRouter.post(
  '/:id/sync/apply',
  validate(applyOverridesSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connection = await loadAuthorizedConnection(req, 'connection:sync');
      const { snapshot, overrides } = req.body;
      const startedAt = Date.now();
      const version = await applySyncSnapshot(connection.id, snapshot, req.user!.userId, overrides || {});
      recordAuditAsync({
        category: 'sync',
        action: 'sync.apply',
        req,
        result: 'success',
        target: { type: 'connection', id: connection.id, label: connection.name },
        metadata: {
          duration_ms: Date.now() - startedAt,
          version_id: (version as any)?.id,
          version_number: (version as any)?.version_number,
          override_count: Object.keys(overrides || {}).length,
        },
      });
      res.json(version);
    } catch (error) {
      next(error);
    }
  },
);

// POST /connections/:id/data-preview - fetch sample rows from a live table
const dataPreviewSchema = z.object({
  tableId: z.number().int().positive(),
  limit: z.number().int().min(1).max(1000).optional().default(10),
});

connectionActionsRouter.post(
  '/:id/data-preview',
  validate(dataPreviewSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connection = await loadAuthorizedConnection(req, 'dictionary:read');
      const { tableId, limit } = req.body;

      // Look up the table name from dictionary metadata — never from user input.
      const tableRow = await knex('dictionary_tables').where({ id: tableId }).first() as any;
      if (!tableRow) {
        throw new AppError('Table not found in dictionary metadata', 404);
      }

      // Verify the table belongs to a version owned by this connection.
      const version = await knex('dictionary_versions')
        .where({ id: tableRow.version_id, connection_id: connection.id })
        .first();
      if (!version) {
        throw new AppError('Table does not belong to this connection', 403);
      }

      const password = decrypt(connection.encrypted_password);
      const adapter = createAdapter(connection.db_type, {
        host: connection.host,
        port: connection.port,
        database: connection.database_name,
        username: connection.username,
        password,
        extraConfig: connection.extra_config ? JSON.parse(connection.extra_config) : {},
      });

      try {
        const result = await adapter.getSampleRows(tableRow.table_name, limit);
        res.json(result);
      } finally {
        try { await adapter.disconnect(); } catch { /* noop */ }
      }
    } catch (error) {
      next(error);
    }
  },
);
