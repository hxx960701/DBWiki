import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import knex from '../database/connection.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/error-handler.js';
import { recordAuditAsync } from '../services/audit-log.js';

export const adminRouter = Router();

// All admin routes require authentication; per-route permission checks below.
adminRouter.use(authenticate);

const roleStringSchema = z.object({
  role: z.enum(['admin', 'editor', 'viewer']),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
});

const createUserSchema = z.object({
  username: z.string().min(3),
  email: z.string().email().optional(),
  password: z.string().min(6),
  display_name: z.string().max(100).optional(),
  role: z.enum(['admin', 'editor', 'viewer']).optional().default('viewer'),
  // Optional: list of role IDs or role names to grant globally on creation.
  role_ids: z.array(z.number().int().positive()).optional(),
  role_names: z.array(z.string()).optional(),
});

const setRolesSchema = z.object({
  role_ids: z.array(z.number().int().positive()).optional(),
  role_names: z.array(z.string()).optional(),
}).refine((d) => !!(d.role_ids || d.role_names), { message: 'role_ids or role_names required' });

async function resolveRoleIds(roleIds?: number[], roleNames?: string[]): Promise<number[]> {
  const ids = new Set<number>();
  if (roleIds) for (const id of roleIds) ids.add(id);
  if (roleNames && roleNames.length > 0) {
    const rows = await knex('roles').whereIn('name', roleNames).pluck('id');
    for (const id of rows) ids.add(id);
  }
  return Array.from(ids);
}

async function attachRolesToUser(userId: number, roleNamesPayload: { role_ids?: number[]; role_names?: string[] }) {
  const ids = await resolveRoleIds(roleNamesPayload.role_ids, roleNamesPayload.role_names);
  if (ids.length === 0) return;
  // Insert ignoring duplicates
  for (const rid of ids) {
    const exists = await knex('user_roles').where({ user_id: userId, role_id: rid }).first();
    if (!exists) {
      await knex('user_roles').insert({ user_id: userId, role_id: rid });
    }
  }
}

// GET /admin/users — list users (search supported)
adminRouter.get(
  '/users',
  requirePermission('user:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
      const offset = (page - 1) * pageSize;
      const search = (req.query.search as string | undefined)?.trim();

      const baseQuery = knex('users as u');
      if (search) {
        baseQuery.where(function () {
          this.whereLike('u.username', `%${search}%`)
            .orWhereLike('u.display_name', `%${search}%`)
            .orWhereLike('u.email', `%${search}%`);
        });
      }

      const countResult = await baseQuery.clone().count('* as total').first();
      const total = Number((countResult as any)?.total ?? 0);

      const users = await baseQuery
        .clone()
        .select(
          'u.id',
          'u.username',
          'u.display_name',
          'u.email',
          'u.role',
          'u.created_at',
          'u.updated_at',
          knex.raw('(SELECT COUNT(DISTINCT project_id) FROM project_members WHERE user_id = u.id) as project_count'),
        )
        .orderBy('u.created_at', 'desc')
        .limit(pageSize)
        .offset(offset);

      // Attach role names for display.
      const userIds = users.map((u: any) => u.id);
      const roles = userIds.length
        ? await knex('user_roles as ur')
            .join('roles as r', 'r.id', 'ur.role_id')
            .whereIn('ur.user_id', userIds)
            .select('ur.user_id', 'r.id as role_id', 'r.name as role_name')
        : [];
      const rolesByUser = new Map<number, Array<{ role_id: number; role_name: string }>>();
      for (const r of roles) {
        const arr = rolesByUser.get(r.user_id) || [];
        arr.push({ role_id: r.role_id, role_name: r.role_name });
        rolesByUser.set(r.user_id, arr);
      }
      const enriched = users.map((u: any) => ({ ...u, roles: rolesByUser.get(u.id) || [] }));

      res.json({
        data: enriched,
        pagination: { page, pageSize, total },
      });
    } catch (error) {
      next(error);
    }
  },
);

// GET /admin/users/search — lighter list used by the project member picker.
// Supports `q` (substring), `roleName`/`roleId` (filter by user's global role),
// `excludeProjectId` (filter out users already members of the project).
adminRouter.get(
  '/users/search',
  requirePermission('user:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = (req.query.q as string | undefined)?.trim();
      const roleName = (req.query.roleName as string | undefined)?.trim();
      const roleId = req.query.roleId ? parseInt(req.query.roleId as string, 10) : undefined;
      const excludeProjectId = req.query.excludeProjectId
        ? parseInt(req.query.excludeProjectId as string, 10)
        : undefined;

      const query = knex('users as u').select('u.id', 'u.username', 'u.display_name', 'u.email', 'u.role').limit(50);

      if (q) {
        query.where(function () {
          this.whereLike('u.username', `%${q}%`)
            .orWhereLike('u.display_name', `%${q}%`)
            .orWhereLike('u.email', `%${q}%`);
        });
      }

      if (roleId || roleName) {
        query.whereExists(function () {
          this.select('*')
            .from('user_roles as ur')
            .leftJoin('roles as r', 'r.id', 'ur.role_id')
            .whereRaw('ur.user_id = u.id');
          if (roleId) {
            this.andWhere('ur.role_id', roleId);
          } else if (roleName) {
            this.andWhere('r.name', roleName);
          }
        });
      }

      if (excludeProjectId) {
        query.whereNotExists(function () {
          this.select('*')
            .from('project_members as pm')
            .whereRaw('pm.user_id = u.id')
            .andWhere('pm.project_id', excludeProjectId);
        });
      }

      const users = await query.orderBy('u.username');
      const userIds = users.map((u: any) => u.id);
      const roles = userIds.length
        ? await knex('user_roles as ur')
            .join('roles as r', 'r.id', 'ur.role_id')
            .whereIn('ur.user_id', userIds)
            .select('ur.user_id', 'r.name as role_name')
        : [];
      const rolesByUser = new Map<number, string[]>();
      for (const r of roles) {
        const arr = rolesByUser.get(r.user_id) || [];
        arr.push(r.role_name);
        rolesByUser.set(r.user_id, arr);
      }
      res.json(users.map((u: any) => ({ ...u, roles: rolesByUser.get(u.id) || [] })));
    } catch (error) {
      next(error);
    }
  },
);

// POST /admin/users — create a user (replaces public registration)
adminRouter.post(
  '/users',
  requirePermission('user:manage'),
  validate(createUserSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, email, password, role, display_name, role_ids, role_names } = req.body;

      // Email is optional; generate a unique placeholder if not provided.
      const resolvedEmail = email || `${username}@local`;

      const existing = await knex('users')
        .where({ username })
        .orWhere({ email: resolvedEmail })
        .first();
      if (existing) {
        throw new AppError('Username or email already exists', 409);
      }

      const password_hash = await bcrypt.hash(password, 10);
      const [userId] = await knex('users').insert({
        username,
        email: resolvedEmail,
        display_name: display_name || '',
        password_hash,
        role,
      });

      // Attach explicitly-supplied roles, plus a sensible default tied to the
      // legacy role string so the user actually has permissions out of the gate.
      const defaultRoleName =
        role === 'admin' ? 'system-admin' : role === 'editor' || role === 'viewer' ? 'general-user' : 'general-user';
      const defaultRole = await knex('roles').where({ name: defaultRoleName }).first();
      const namesToAttach = new Set<string>(role_names || []);
      if (defaultRole) namesToAttach.add(defaultRole.name);

      await attachRolesToUser(userId, {
        role_ids,
        role_names: Array.from(namesToAttach),
      });

      const created = await knex('users')
        .select('id', 'username', 'display_name', 'email', 'role', 'created_at', 'updated_at')
        .where({ id: userId })
        .first();
      recordAuditAsync({
        category: 'user_mgmt',
        action: 'user.create',
        req,
        result: 'success',
        target: { type: 'user', id: userId, label: display_name || username },
        metadata: { role, role_ids, role_names },
      });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  },
);

// PUT /admin/users/:id/role — update legacy role string (kept for backward compat)
adminRouter.put(
  '/users/:id/role',
  requirePermission('user:manage'),
  validate(roleStringSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = parseInt(req.params.id as string, 10);
      const { role } = req.body;

      if (userId === req.user!.userId) {
        throw new AppError('Cannot change your own role', 400);
      }

      const user = await knex('users').where({ id: userId }).first();
      if (!user) {
        throw new AppError('User not found', 404);
      }

      await knex('users')
        .where({ id: userId })
        .update({ role, updated_at: knex.fn.now() });

      const updated = await knex('users')
        .select('id', 'username', 'display_name', 'email', 'role', 'created_at', 'updated_at')
        .where({ id: userId })
        .first();

      recordAuditAsync({
        category: 'user_mgmt',
        action: 'user.update_role',
        req,
        result: 'success',
        target: { type: 'user', id: userId, label: user.display_name || user.username },
        metadata: { from: user.role, to: role },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

// PUT /admin/users/:id/roles — replace the user's full set of global roles.
adminRouter.put(
  '/users/:id/roles',
  requirePermission('user:manage'),
  validate(setRolesSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = parseInt(req.params.id as string, 10);
      const { role_ids, role_names } = req.body;
      const user = await knex('users').where({ id: userId }).first();
      if (!user) throw new AppError('User not found', 404);

      const ids = await resolveRoleIds(role_ids, role_names);

      await knex.transaction(async (trx) => {
        await trx('user_roles').where({ user_id: userId }).delete();
        if (ids.length > 0) {
          await trx('user_roles').insert(ids.map((rid) => ({ user_id: userId, role_id: rid })));
        }
      });

      const refreshed = await knex('user_roles as ur')
        .join('roles as r', 'r.id', 'ur.role_id')
        .where('ur.user_id', userId)
        .select('r.id as role_id', 'r.name as role_name');
      recordAuditAsync({
        category: 'user_mgmt',
        action: 'user.set_roles',
        req,
        result: 'success',
        target: { type: 'user', id: userId, label: user.display_name || user.username },
        metadata: { roles: refreshed.map((r: any) => r.role_name) },
      });
      res.json({ user_id: userId, roles: refreshed });
    } catch (error) {
      next(error);
    }
  },
);

const updateDisplayNameSchema = z.object({
  display_name: z.string().min(1).max(100),
});

// PUT /admin/users/:id/display-name — update user's display name
adminRouter.put(
  '/users/:id/display-name',
  requirePermission('user:manage'),
  validate(updateDisplayNameSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = parseInt(req.params.id as string, 10);
      const { display_name } = req.body;

      const user = await knex('users').where({ id: userId }).first();
      if (!user) throw new AppError('User not found', 404);

      await knex('users').where({ id: userId }).update({ display_name, updated_at: knex.fn.now() });

      const updated = await knex('users')
        .select('id', 'username', 'display_name', 'email', 'role', 'created_at', 'updated_at')
        .where({ id: userId })
        .first();
      recordAuditAsync({
        category: 'user_mgmt',
        action: 'user.update_display_name',
        req,
        result: 'success',
        target: { type: 'user', id: userId, label: display_name },
        metadata: { from: user.display_name, to: display_name },
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /admin/users/:id — delete user and all related rows (CASCADE handles user_roles, project_members).
adminRouter.delete(
  '/users/:id',
  requirePermission('user:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = parseInt(req.params.id as string, 10);

      if (userId === req.user!.userId) {
        throw new AppError('Cannot delete your own account', 400);
      }

      const user = await knex('users').where({ id: userId }).first();
      if (!user) {
        throw new AppError('User not found', 404);
      }

      await knex('users').where({ id: userId }).delete();
      recordAuditAsync({
        category: 'user_mgmt',
        action: 'user.delete',
        req,
        result: 'success',
        target: { type: 'user', id: userId, label: user.display_name || user.username },
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

// PUT /admin/users/:id/reset-password
adminRouter.put(
  '/users/:id/reset-password',
  requirePermission('user:manage'),
  validate(resetPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = parseInt(req.params.id as string, 10);
      const { newPassword } = req.body;

      const user = await knex('users').where({ id: userId }).first();
      if (!user) {
        throw new AppError('User not found', 404);
      }

      const password_hash = await bcrypt.hash(newPassword, 10);

      await knex('users')
        .where({ id: userId })
        .update({ password_hash, updated_at: knex.fn.now() });

      recordAuditAsync({
        category: 'user_mgmt',
        action: 'user.reset_password',
        req,
        result: 'success',
        target: { type: 'user', id: userId, label: user.display_name || user.username },
      });

      res.json({ message: 'Password reset successfully' });
    } catch (error) {
      next(error);
    }
  },
);
