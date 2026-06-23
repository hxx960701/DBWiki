import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import knex from '../database/connection.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission, requireProjectPermission } from '../middleware/permission.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/error-handler.js';
import { encrypt, decrypt } from '../services/encryption.js';
import { getProjectPermissions } from '../services/permissions.js';
import type { Project } from '../types/index.js';

export const projectsRouter = Router();

// All project routes require authentication
projectsRouter.use(authenticate);

const projectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional().default(''),
});

// Members can be added either by passing roleName ('project-admin' / 'project-editor' / 'project-viewer')
// or by passing role_id directly. roleName is preferred from the UI.
const memberSchema = z.object({
  userId: z.number().int().positive('Invalid user ID'),
  roleName: z.string().min(1).optional(),
  role_id: z.number().int().positive().optional(),
}).refine((d) => !!(d.roleName || d.role_id), { message: 'roleName or role_id required' });

const memberUpdateSchema = z.object({
  roleName: z.string().min(1).optional(),
  role_id: z.number().int().positive().optional(),
}).refine((d) => !!(d.roleName || d.role_id), { message: 'roleName or role_id required' });

const memberBatchSchema = z.object({
  user_ids: z.array(z.number().int().positive()).min(1, 'At least one user required'),
  roleName: z.string().min(1).optional(),
  role_id: z.number().int().positive().optional(),
}).refine((d) => !!(d.roleName || d.role_id), { message: 'roleName or role_id required' });

async function resolveRoleId(roleName?: string, roleId?: number): Promise<number> {
  if (roleId) {
    const role = await knex('roles').where({ id: roleId }).first();
    if (!role) throw new AppError('Role not found', 404);
    return role.id;
  }
  if (roleName) {
    const role = await knex('roles').where({ name: roleName }).first();
    if (!role) throw new AppError(`Role "${roleName}" not found`, 404);
    return role.id;
  }
  throw new AppError('Role identifier required', 400);
}

// GET /projects - list projects with pagination and search
projectsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * pageSize;
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'admin';

    const baseQuery = knex('projects as p');

    // Non-admin users only see projects they created or are members of
    if (!isAdmin) {
      baseQuery.where(function () {
        this.where('p.created_by', userId).orWhereExists(function () {
          this.select('*')
            .from('project_members')
            .whereRaw('project_members.project_id = p.id')
            .andWhere('project_members.user_id', userId);
        });
      });
    }

    if (search) {
      baseQuery.where(function () {
        this.whereLike('p.name', `%${search}%`)
          .orWhereLike('p.description', `%${search}%`);
      });
    }

    // Count total matching projects
    const countResult = await baseQuery.clone().count('* as total').first();
    const total = Number((countResult as any)?.total ?? 0);

    // Fetch paginated results with creator name and member count
    const projects = await baseQuery
      .clone()
      .select(
        'p.*',
        knex.raw('(SELECT username FROM users WHERE id = p.created_by) as creator_name'),
        knex.raw('(SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count'),
      )
      .orderBy('p.created_at', 'desc')
      .limit(pageSize)
      .offset(offset);

    res.json({
      data: projects,
      pagination: { page, pageSize, total },
    });
  } catch (error) {
    next(error);
  }
});

// POST /projects - create project (anyone with project:create permission)
projectsRouter.post(
  '/',
  requirePermission('project:create'),
  validate(projectSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, description } = req.body;
      const userId = req.user!.userId;

      // Look up the project-admin role so the creator becomes one.
      const projectAdminRole = await knex('roles').where({ name: 'project-admin' }).first();
      if (!projectAdminRole) {
        throw new AppError('Built-in project-admin role missing', 500);
      }

      const [id] = await knex('projects').insert({
        name,
        description: description || '',
        created_by: userId,
      });

      // Auto-insert creator as project admin (both legacy `role` string and new `role_id`).
      await knex('project_members').insert({
        project_id: id,
        user_id: userId,
        role: 'admin',
        role_id: projectAdminRole.id,
      });

      const project = await knex('projects').where({ id }).first();

      res.status(201).json(project);
    } catch (error) {
      next(error);
    }
  },
);

// GET /projects/:id - get project details (with current user's effective permissions)
projectsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = parseInt(req.params.id as string, 10);
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'admin';

    const project = await knex('projects').where({ id: projectId }).first() as Project | undefined;
    if (!project) {
      throw new AppError('Project not found', 404);
    }

    // Compute effective permissions for the current user against this project.
    // Non-admins must have at least project:read to see the project.
    const currentUserPermissions = await getProjectPermissions(userId, projectId);
    if (!isAdmin) {
      const isCreator = project.created_by === userId;
      const isMember = await knex('project_members')
        .where({ project_id: projectId, user_id: userId })
        .first();

      if (!isCreator && !isMember && !currentUserPermissions.includes('project:read')) {
        throw new AppError('Access denied', 403);
      }
    }

    // Members joined with role name for display purposes.
    const members = await knex('project_members as pm')
      .leftJoin('users as u', 'u.id', 'pm.user_id')
      .leftJoin('roles as r', 'r.id', 'pm.role_id')
      .where('pm.project_id', projectId)
      .select(
        'pm.id',
        'pm.project_id',
        'pm.user_id',
        'pm.role_id',
        'pm.role',
        'pm.created_at',
        'u.username',
        'u.display_name',
        'u.email',
        'r.name as role_name',
      );

    const connectionCountResult = await knex('database_connections')
      .where({ project_id: projectId })
      .count('* as count')
      .first();

    res.json({
      ...project,
      members,
      connection_count: Number((connectionCountResult as any)?.count ?? 0),
      current_user_permissions: currentUserPermissions,
    });
  } catch (error) {
    next(error);
  }
});

// PUT /projects/:id - update project
projectsRouter.put(
  '/:id',
  requireProjectPermission('project:update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);
      const updateData = projectSchema.parse(req.body);

      const updated = await knex('projects')
        .where({ id: projectId })
        .update({
          name: updateData.name,
          description: updateData.description || '',
          updated_at: knex.fn.now(),
        });

      if (!updated) {
        throw new AppError('Project not found', 404);
      }

      const project = await knex('projects').where({ id: projectId }).first();

      res.json(project);
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /projects/:id - delete project (CASCADE handles related records)
projectsRouter.delete(
  '/:id',
  requireProjectPermission('project:delete'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);

      const deleted = await knex('projects').where({ id: projectId }).delete();

      if (!deleted) {
        throw new AppError('Project not found', 404);
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

// POST /projects/:id/members - add a single member to project
projectsRouter.post(
  '/:id/members',
  requireProjectPermission('project:member:manage'),
  validate(memberSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);
      const { userId, roleName, role_id } = req.body;

      // Verify target user exists
      const targetUser = await knex('users').where({ id: userId }).first();
      if (!targetUser) {
        throw new AppError('User not found', 404);
      }

      // Check if already a member
      const existing = await knex('project_members')
        .where({ project_id: projectId, user_id: userId })
        .first();

      if (existing) {
        throw new AppError('User is already a member of this project', 409);
      }

      const resolvedRoleId = await resolveRoleId(roleName, role_id);
      const role = await knex('roles').where({ id: resolvedRoleId }).first();

      // Map role name back to legacy role string for backward compat where possible.
      const legacyRole = mapRoleNameToLegacy(role.name);

      const [id] = await knex('project_members').insert({
        project_id: projectId,
        user_id: userId,
        role: legacyRole,
        role_id: resolvedRoleId,
      });

      const member = await knex('project_members').where({ id }).first();

      res.status(201).json(member);
    } catch (error) {
      next(error);
    }
  },
);

// POST /projects/:id/members/batch - add many users to a project at once
projectsRouter.post(
  '/:id/members/batch',
  requireProjectPermission('project:member:manage'),
  validate(memberBatchSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);
      const { user_ids, roleName, role_id } = req.body;

      const resolvedRoleId = await resolveRoleId(roleName, role_id);
      const role = await knex('roles').where({ id: resolvedRoleId }).first();
      const legacyRole = mapRoleNameToLegacy(role.name);

      // Filter out users that are already members.
      const existing = await knex('project_members')
        .where({ project_id: projectId })
        .whereIn('user_id', user_ids)
        .pluck('user_id');
      const existingSet = new Set<number>(existing);
      const toAdd = user_ids.filter((id: number) => !existingSet.has(id));

      let added = 0;
      const skipped = user_ids.length - toAdd.length;

      if (toAdd.length > 0) {
        await knex.transaction(async (trx) => {
          for (const uid of toAdd) {
            // Verify the user exists; silently skip if not (consistent with batch semantics).
            const exists = await trx('users').where({ id: uid }).first();
            if (!exists) continue;
            await trx('project_members').insert({
              project_id: projectId,
              user_id: uid,
              role: legacyRole,
              role_id: resolvedRoleId,
            });
            added++;
          }
        });
      }

      res.status(201).json({ added, skipped });
    } catch (error) {
      next(error);
    }
  },
);

// PUT /projects/:id/members/:userId - update an existing member's role
projectsRouter.put(
  '/:id/members/:userId',
  requireProjectPermission('project:member:manage'),
  validate(memberUpdateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);
      const memberUserId = parseInt(req.params.userId as string, 10);
      const { roleName, role_id } = req.body;

      const member = await knex('project_members')
        .where({ project_id: projectId, user_id: memberUserId })
        .first();
      if (!member) {
        throw new AppError('Member not found', 404);
      }

      const resolvedRoleId = await resolveRoleId(roleName, role_id);
      const role = await knex('roles').where({ id: resolvedRoleId }).first();
      const legacyRole = mapRoleNameToLegacy(role.name);

      await knex('project_members')
        .where({ id: member.id })
        .update({ role: legacyRole, role_id: resolvedRoleId });

      const updated = await knex('project_members').where({ id: member.id }).first();
      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /projects/:id/members/:userId - remove member from project
projectsRouter.delete(
  '/:id/members/:userId',
  requireProjectPermission('project:member:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);
      const memberUserId = parseInt(req.params.userId as string, 10);

      // Cannot remove the project creator
      const project = await knex('projects').where({ id: projectId }).first() as Project | undefined;
      if (!project) {
        throw new AppError('Project not found', 404);
      }

      if (project.created_by === memberUserId) {
        throw new AppError('Cannot remove the project creator', 400);
      }

      const deleted = await knex('project_members')
        .where({ project_id: projectId, user_id: memberUserId })
        .delete();

      if (!deleted) {
        throw new AppError('Member not found', 404);
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

// ============================================================
// Project role bindings (project ↔ role)
// ============================================================

const roleBindingSchema = z.object({
  role_id: z.number().int().positive().optional(),
  roleName: z.string().min(1).optional(),
}).refine((d) => !!(d.roleName || d.role_id), { message: 'role_id or roleName required' });

// GET /projects/:id/role-bindings
projectsRouter.get(
  '/:id/role-bindings',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);
      const userId = req.user!.userId;
      const isAdmin = req.user!.role === 'admin';

      // Anyone with project:read can view the bindings.
      if (!isAdmin) {
        const perms = await getProjectPermissions(userId, projectId);
        if (!perms.includes('project:read')) {
          throw new AppError('Access denied', 403);
        }
      }

      const bindings = await knex('project_role_bindings as prb')
        .leftJoin('roles as r', 'r.id', 'prb.role_id')
        .where('prb.project_id', projectId)
        .select('prb.id', 'prb.project_id', 'prb.role_id', 'prb.created_at', 'r.name as role_name', 'r.description as role_description');

      res.json(bindings);
    } catch (error) {
      next(error);
    }
  },
);

// POST /projects/:id/role-bindings
projectsRouter.post(
  '/:id/role-bindings',
  requireProjectPermission('project:member:manage'),
  validate(roleBindingSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);
      const { role_id, roleName } = req.body;
      const resolvedRoleId = await resolveRoleId(roleName, role_id);

      const existing = await knex('project_role_bindings')
        .where({ project_id: projectId, role_id: resolvedRoleId })
        .first();
      if (existing) {
        throw new AppError('Role already bound to this project', 409);
      }

      const [id] = await knex('project_role_bindings').insert({
        project_id: projectId,
        role_id: resolvedRoleId,
      });
      const binding = await knex('project_role_bindings').where({ id }).first();
      res.status(201).json(binding);
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /projects/:id/role-bindings/:bindingId
projectsRouter.delete(
  '/:id/role-bindings/:bindingId',
  requireProjectPermission('project:member:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);
      const bindingId = parseInt(req.params.bindingId as string, 10);
      const deleted = await knex('project_role_bindings')
        .where({ id: bindingId, project_id: projectId })
        .delete();
      if (!deleted) throw new AppError('Binding not found', 404);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

// ============================================================
// Connection CRUD routes (nested under projects)
// ============================================================

const connectionSchema = z.object({
  name: z.string().min(1, 'Connection name is required'),
  db_type: z.enum(['mysql', 'postgresql', 'mssql', 'oracle', 'starrocks', 'clickhouse', 'influxdb']),
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().positive('Port must be a positive integer'),
  database_name: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string(),
  // Accept either a JSON string or a plain object (the frontend has historically sent both).
  extra_config: z.union([z.string(), z.record(z.any())]).optional(),
});

function normalizeExtraConfig(value: unknown): string {
  if (value === undefined || value === null || value === '') return '{}';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

// Mask sensitive fields for non-privileged readers.
function maskConnection(connection: any, canSeeSecrets: boolean): Record<string, any> {
  if (canSeeSecrets) {
    return connection;
  }
  const { encrypted_password, ...rest } = connection;
  return { ...rest, username: '***' };
}

// GET /projects/:id/connections - list connections for a project
projectsRouter.get(
  '/:id/connections',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);
      const userId = req.user!.userId;
      const isAdmin = req.user!.role === 'admin';

      const perms = await getProjectPermissions(userId, projectId);
      if (!isAdmin && !perms.includes('project:read') && !perms.includes('dictionary:read')) {
        throw new AppError('Access denied', 403);
      }
      const canSeeSecrets = isAdmin || perms.includes('connection:manage');

      const connections = await knex('database_connections as dc')
        .select('dc.*')
        .where('dc.project_id', projectId)
        .orderBy('dc.created_at', 'desc');

      const connectionsWithVersions = await Promise.all(
        connections.map(async (conn: any) => {
          const latestVersion = await knex('dictionary_versions')
            .where({ connection_id: conn.id, status: 'published' })
            .orderBy('version_number', 'desc')
            .first();

          const masked = maskConnection(conn, canSeeSecrets);
          return { ...masked, latest_version: latestVersion || null };
        }),
      );

      res.json(connectionsWithVersions);
    } catch (error) {
      next(error);
    }
  },
);

// POST /projects/:id/connections - create a new connection
projectsRouter.post(
  '/:id/connections',
  requireProjectPermission('connection:manage'),
  validate(connectionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);
      const { name, db_type, host, port, database_name, username, password, extra_config } = req.body;

      const encrypted_password = encrypt(password);

      const [id] = await knex('database_connections').insert({
        project_id: projectId,
        name,
        db_type,
        host,
        port,
        database_name,
        username,
        encrypted_password,
        extra_config: normalizeExtraConfig(extra_config),
        created_by: req.user!.userId,
      });

      const connection = await knex('database_connections').where({ id }).first();

      res.status(201).json(connection);
    } catch (error) {
      next(error);
    }
  },
);

// GET /projects/:id/connections/:connId - get a single connection.
// Returns the decrypted password to anyone who has connection:manage on the project,
// so they can pre-fill an edit modal or run a "test connection" without re-entering it.
projectsRouter.get(
  '/:id/connections/:connId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);
      const connectionId = parseInt(req.params.connId as string, 10);
      const userId = req.user!.userId;
      const isAdmin = req.user!.role === 'admin';

      const perms = await getProjectPermissions(userId, projectId);
      if (!isAdmin && !perms.includes('project:read')) {
        throw new AppError('Access denied', 403);
      }

      const connection = await knex('database_connections')
        .where({ id: connectionId, project_id: projectId })
        .first();

      if (!connection) {
        throw new AppError('Connection not found', 404);
      }

      const canSeeSecrets = isAdmin || perms.includes('connection:manage');
      if (canSeeSecrets) {
        const decrypted = {
          ...connection,
          password: decrypt(connection.encrypted_password),
        };
        res.json(decrypted);
      } else {
        res.json(maskConnection(connection, false));
      }
    } catch (error) {
      next(error);
    }
  },
);

// PUT /projects/:id/connections/:connId - update a connection
projectsRouter.put(
  '/:id/connections/:connId',
  requireProjectPermission('connection:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);
      const connectionId = parseInt(req.params.connId as string, 10);

      const existing = await knex('database_connections')
        .where({ id: connectionId, project_id: projectId })
        .first();

      if (!existing) {
        throw new AppError('Connection not found', 404);
      }

      const updateFields: Record<string, any> = {};
      const { name, db_type, host, port, database_name, username, password, extra_config } = req.body;

      if (name !== undefined) updateFields.name = name;
      if (db_type !== undefined) updateFields.db_type = db_type;
      if (host !== undefined) updateFields.host = host;
      if (port !== undefined) updateFields.port = port;
      if (database_name !== undefined) updateFields.database_name = database_name;
      if (username !== undefined) updateFields.username = username;
      if (extra_config !== undefined) updateFields.extra_config = normalizeExtraConfig(extra_config);

      if (password !== undefined && password !== '') {
        updateFields.encrypted_password = encrypt(password);
      }

      updateFields.updated_at = knex.fn.now();

      await knex('database_connections')
        .where({ id: connectionId })
        .update(updateFields);

      const connection = await knex('database_connections')
        .where({ id: connectionId })
        .first();

      res.json(connection);
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /projects/:id/connections/:connId - delete a connection
projectsRouter.delete(
  '/:id/connections/:connId',
  requireProjectPermission('connection:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseInt(req.params.id as string, 10);
      const connectionId = parseInt(req.params.connId as string, 10);

      const deleted = await knex('database_connections')
        .where({ id: connectionId, project_id: projectId })
        .delete();

      if (!deleted) {
        throw new AppError('Connection not found', 404);
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

// Helper: best-effort mapping from new role names to legacy `role` enum values.
// Stored to keep the legacy column populated for any code paths that haven't migrated.
function mapRoleNameToLegacy(name: string): 'admin' | 'editor' | 'viewer' {
  if (name === 'project-admin' || name === 'system-admin') return 'admin';
  if (name === 'project-editor') return 'editor';
  return 'viewer';
}
