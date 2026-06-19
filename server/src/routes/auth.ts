import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import knex from '../database/connection.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/error-handler.js';
import { getGlobalPermissions } from '../services/permissions.js';

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
        throw new AppError('Invalid credentials', 401);
      }

      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
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

      res.json({
        token,
        user: { ...userWithoutPassword, permissions },
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
