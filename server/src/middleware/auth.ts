import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './error-handler.js';
import knex from '../database/connection.js';
import type { JwtPayload } from '../types/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

/**
 * Per-user throttle for last_seen_at writes. We refresh the column at most
 * once every LAST_SEEN_THROTTLE_MS so a busy session doesn't hammer the DB.
 * The map is process-local, which is acceptable: in a multi-process deploy
 * each process simply writes its own first-tick value, and the column still
 * reflects "recent activity within ~30s" everywhere.
 */
const LAST_SEEN_THROTTLE_MS = 30 * 1000;
const lastSeenWriteAt = new Map<number, number>();

function touchLastSeen(userId: number) {
  const now = Date.now();
  const prev = lastSeenWriteAt.get(userId) || 0;
  if (now - prev < LAST_SEEN_THROTTLE_MS) return;
  lastSeenWriteAt.set(userId, now);
  // Fire-and-forget; never let the auth path block or fail on this.
  knex('users')
    .where({ id: userId })
    .update({ last_seen_at: knex.fn.now() })
    .catch(() => {
      /* swallow — observability must never break auth */
    });
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 401));
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = payload;
    if (payload?.userId) touchLastSeen(payload.userId);
    next();
  } catch {
    return next(new AppError('Invalid or expired token', 401));
  }
}
