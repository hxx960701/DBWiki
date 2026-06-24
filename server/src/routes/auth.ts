import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import knex from '../database/connection.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/error-handler.js';
import { getGlobalPermissions } from '../services/permissions.js';
import { recordAuditAsync } from '../services/audit-log.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

// NOTE: POST /auth/register has been removed. New users are created by an admin
// via POST /admin/users. See routes/admin.ts.

// POST /auth/login
authRouter.post(
  '/login',
  validate(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = req.body;

      const user = await knex('users').where({ username }).first();

      if (!user) {
        recordAuditAsync({
          category: 'auth',
          action: 'login.fail',
          req,
          actorUserId: null,
          actorUsername: username,
          result: 'failure',
          message: 'Unknown user',
        });
        throw new AppError('Invalid credentials', 401);
      }

      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        recordAuditAsync({
          category: 'auth',
          action: 'login.fail',
          req,
          actorUserId: user.id,
          actorUsername: user.username,
          result: 'failure',
          message: 'Invalid password',
        });
        throw new AppError('Invalid credentials', 401);
      }

      // Resolve the user's global permissions and pack them into the JWT
      // so middleware can fast-path most checks without a DB roundtrip.
      const permissions = await getGlobalPermissions(user.id);

      const token = jwt.sign(
        {
          userId: user.id,
          username: user.username,
          role: user.role,
          permissions,
        },
        JWT_SECRET,
        { expiresIn: '24h' },
      );

      const { password_hash: _, ...userWithoutPassword } = user;

      // Non-admin users who haven't changed their password yet must change it on first login
      const mustChangePassword = user.role !== 'admin' && !user.password_changed;

      // Best-effort: track last login timestamp + originating IP for the admin dashboard.
      const xf = (req.headers['x-forwarded-for'] || '') as string;
      const loginIp = (xf.split(',')[0]?.trim() || req.ip || '').toString().slice(0, 64);
      knex('users')
        .where({ id: user.id })
        .update({ last_login_at: knex.fn.now(), last_login_ip: loginIp, last_seen_at: knex.fn.now() })
        .catch(() => { /* never block login on observability */ });

      recordAuditAsync({
        category: 'auth',
        action: 'login.success',
        req,
        actorUserId: user.id,
        actorUsername: user.username,
        result: 'success',
      });

      res.json({
        token,
        user: { ...userWithoutPassword, permissions },
        mustChangePassword,
      });
    } catch (error) {
      next(error);
    }
  },
);

// GET /auth/profile — returns the current user including up-to-date global permissions.
authRouter.get(
  '/profile',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await knex('users')
        .where({ id: req.user!.userId })
        .first();

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const permissions = await getGlobalPermissions(user.id);
      const { password_hash: _, ...userWithoutPassword } = user;

      res.json({ ...userWithoutPassword, permissions });
    } catch (error) {
      next(error);
    }
  },
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

// PUT /auth/password — change own password
authRouter.put(
  '/password',
  authenticate,
  validate(changePasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user!.userId;

      const user = await knex('users').where({ id: userId }).first();
      if (!user) {
        throw new AppError('User not found', 404);
      }

      const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isMatch) {
        throw new AppError('Current password is incorrect', 400);
      }

      const newPasswordHash = await bcrypt.hash(newPassword, 10);
      await knex('users').where({ id: userId }).update({
        password_hash: newPasswordHash,
        password_changed: true,
        updated_at: knex.fn.now(),
      });

      recordAuditAsync({
        category: 'auth',
        action: 'password.change',
        req,
        result: 'success',
        target: { type: 'user', id: userId, label: user.username },
      });

      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      next(error);
    }
  },
);
