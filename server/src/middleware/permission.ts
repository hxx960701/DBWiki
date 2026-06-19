import { Request, Response, NextFunction } from 'express';
import { AppError } from './error-handler.js';
import { getGlobalPermissions, getProjectPermissions } from '../services/permissions.js';

/**
 * Require a global permission code on the authenticated user.
 *
 * The JWT payload carries the user's global permission codes (as of login),
 * so we check there first to avoid a DB roundtrip. Falls back to a fresh
 * lookup so newly-granted permissions take effect without re-login (rare path
 * in practice — JWT is 24h — but the fallback is cheap).
 */
export function requirePermission(code: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return next(new AppError('Authentication required', 401));
      }

      const cached = req.user.permissions || [];
      if (cached.includes(code)) {
        return next();
      }

      const fresh = await getGlobalPermissions(req.user.userId);
      if (!fresh.includes(code)) {
        return next(new AppError('Insufficient permissions', 403));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Require a project-scoped permission code. The project ID is taken from
 * `req.params.projectId` or `req.params.id`.
 *
 * Resolution merges: global permissions ∪ project_members role ∪ project_role_bindings.
 */
export function requireProjectPermission(code: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return next(new AppError('Authentication required', 401));
      }

      const cached = req.user.permissions || [];
      if (cached.includes(code)) {
        return next();
      }

      const projectIdRaw = (req.params.projectId || req.params.id) as string | undefined;
      const projectId = projectIdRaw ? parseInt(projectIdRaw, 10) : NaN;
      if (!projectId || Number.isNaN(projectId)) {
        return next(new AppError('Project ID required', 400));
      }

      const projectCodes = await getProjectPermissions(req.user.userId, projectId);
      if (!projectCodes.includes(code)) {
        return next(new AppError('Insufficient project permissions', 403));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
