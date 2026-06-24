import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './error-handler.js';
import knex from '../database/connection.js';
import type { JwtPayload } from '../types/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

/**
 * Per-user throttle for last_seen_at writes. The frontend pings
 * POST /auth/heartbeat only while the user is actually interacting with the
 * page (mouse/keyboard activity in a visible tab), so a write per ping is
 * fine, but we still throttle in case a misbehaving client sends them faster.
 *
 * IMPORTANT: we deliberately do NOT touch last_seen_at on every authenticated
 * request — that made the "online" flag mean "browser tab is still open and
 * polling" rather than "user is here", which kept everyone online forever.
 *
 * The map is process-local. In a multi-process deploy each process simply
 * writes its own first-tick value; the column still reflects "recent activity"
 * everywhere within the heartbeat cadence.
 */
const LAST_SEEN_THROTTLE_MS = 30 * 1000;
const lastSeenWriteAt = new Map<number, number>();

export function touchLastSeen(userId: number): void {
  const now = Date.now();
  const prev = lastSeenWriteAt.get(userId) || 0;
  if (now - prev < LAST_SEEN_THROTTLE_MS) return;
  lastSeenWriteAt.set(userId, now);
  // Fire-and-forget; never let observability block or fail anything upstream.
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
    next();
  } catch {
    return next(new AppError('Invalid or expired token', 401));
  }
}
