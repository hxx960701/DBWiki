import { Request, Response, NextFunction } from 'express';
import { AppError } from './error-handler.js';
import knex from '../database/connection.js';

export function authorize(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError('Insufficient permissions', 403);
    }
    next();
  };
}

export function authorizeProjectRole(...roles: string[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    // Global admin bypasses project role check
    if (req.user.role === 'admin') {
      return next();
    }

    const projectId = parseInt((req.params.projectId || req.params.id) as string, 10);
    if (!projectId) {
      throw new AppError('Project ID required', 400);
    }

    const member = await knex('project_members')
      .where({ project_id: projectId, user_id: req.user.userId })
      .first();

    if (!member || !roles.includes(member.role)) {
      throw new AppError('Insufficient project permissions', 403);
    }

    next();
  };
}
