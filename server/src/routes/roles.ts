import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import knex from '../database/connection.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/error-handler.js';
import { recordAuditAsync } from '../services/audit-log.js';

export const rolesRouter = Router();

rolesRouter.use(authenticate);

const upsertRoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  permission_codes: z.array(z.string()).optional().default([]),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  permission_codes: z.array(z.string()).optional(),
});

// GET /roles — list all roles with their permission codes.
rolesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roles = await knex('roles').select('*').orderBy('id');
    const ids = roles.map((r: any) => r.id);
    const rps = ids.length
      ? await knex('role_permissions').whereIn('role_id', ids).select('role_id', 'permission_code')
      : [];
    const codeMap = new Map<number, string[]>();
    for (const rp of rps) {
      const arr = codeMap.get(rp.role_id) || [];
      arr.push(rp.permission_code);
      codeMap.set(rp.role_id, arr);
    }
    res.json(roles.map((r: any) => ({ ...r, permission_codes: codeMap.get(r.id) || [] })));
  } catch (error) {
    next(error);
  }
});

// GET /roles/:id — single role detail
rolesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const role = await knex('roles').where({ id }).first();
    if (!role) throw new AppError('Role not found', 404);
    const codes = await knex('role_permissions').where({ role_id: id }).pluck('permission_code');
    res.json({ ...role, permission_codes: codes });
  } catch (error) {
    next(error);
  }
});

// POST /roles — create a custom role
rolesRouter.post(
  '/',
  requirePermission('role:manage'),
  validate(upsertRoleSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, description, permission_codes } = req.body;

      const existing = await knex('roles').where({ name }).first();
      if (existing) throw new AppError('Role name already exists', 409);

      const validCodes = await knex('permissions').whereIn('code', permission_codes).pluck('code');

      const [id] = await knex('roles').insert({
        name,
        description: description || '',
        is_system: false,
      });
      if (validCodes.length > 0) {
        await knex('role_permissions').insert(validCodes.map((c: string) => ({ role_id: id, permission_code: c })));
      }
      const role = await knex('roles').where({ id }).first();
      recordAuditAsync({
        category: 'role_mgmt',
        action: 'role.create',
        req,
        result: 'success',
        target: { type: 'role', id, label: name },
        metadata: { permission_codes: validCodes },
      });
      res.status(201).json({ ...role, permission_codes: validCodes });
    } catch (error) {
      next(error);
    }
  },
);

// PUT /roles/:id — update a role. System roles can have description and
// permission_codes updated, but their `name` is immutable.
rolesRouter.put(
  '/:id',
  requirePermission('role:manage'),
  validate(updateRoleSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const role = await knex('roles').where({ id }).first();
      if (!role) throw new AppError('Role not found', 404);

      const { name, description, permission_codes } = req.body;

      const updates: Record<string, any> = {};
      if (name !== undefined && !role.is_system) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (Object.keys(updates).length > 0) {
        await knex('roles').where({ id }).update(updates);
      }

      if (permission_codes !== undefined) {
        const validCodes = await knex('permissions').whereIn('code', permission_codes).pluck('code');
        await knex.transaction(async (trx) => {
          await trx('role_permissions').where({ role_id: id }).delete();
          if (validCodes.length > 0) {
            await trx('role_permissions').insert(validCodes.map((c: string) => ({ role_id: id, permission_code: c })));
          }
        });
      }

      const refreshed = await knex('roles').where({ id }).first();
      const codes = await knex('role_permissions').where({ role_id: id }).pluck('permission_code');
      recordAuditAsync({
        category: 'role_mgmt',
        action: 'role.update',
        req,
        result: 'success',
        target: { type: 'role', id, label: refreshed.name },
        metadata: { updates, permission_codes: permission_codes !== undefined ? codes : undefined },
      });
      res.json({ ...refreshed, permission_codes: codes });
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /roles/:id — delete a custom role. System roles cannot be deleted.
rolesRouter.delete(
  '/:id',
  requirePermission('role:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const role = await knex('roles').where({ id }).first();
      if (!role) throw new AppError('Role not found', 404);
      if (role.is_system) throw new AppError('Cannot delete a system role', 400);
      await knex('roles').where({ id }).delete();
      recordAuditAsync({
        category: 'role_mgmt',
        action: 'role.delete',
        req,
        result: 'success',
        target: { type: 'role', id, label: role.name },
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

// GET /roles/:id/users — list users currently bound to this role.
rolesRouter.get(
  '/:id/users',
  requirePermission('role:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const users = await knex('user_roles as ur')
        .join('users as u', 'u.id', 'ur.user_id')
        .where('ur.role_id', id)
        .select('u.id', 'u.username', 'u.display_name', 'u.email');
      res.json(users);
    } catch (error) {
      next(error);
    }
  },
);

// ---- Permissions catalog ----
export const permissionsRouter = Router();
permissionsRouter.use(authenticate);

permissionsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const perms = await knex('permissions').orderBy([{ column: 'scope' }, { column: 'code' }]);
    res.json(perms);
  } catch (error) {
    next(error);
  }
});
