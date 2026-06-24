import type { Request } from 'express';
import knex from '../database/connection.js';

/**
 * Append-only audit log writer.
 *
 * Design notes:
 *  - Writes are best-effort. A failure here MUST NOT break the underlying
 *    business request — every public helper traps and logs errors.
 *  - `recordAuditAsync` schedules the insert via `setImmediate` so it never
 *    adds latency to the response path. The caller can `void` it freely.
 *  - Actor identity, IP, and UA are extracted from `req` when supplied; the
 *    caller can override any field (e.g. login.fail has no `req.user`).
 */

export type AuditCategory =
  | 'auth'
  | 'sync'
  | 'dictionary'
  | 'user_mgmt'
  | 'role_mgmt'
  | 'system';

export interface AuditTarget {
  type?: string;
  id?: number | null;
  label?: string;
}

export interface AuditInput {
  category: AuditCategory;
  action: string;
  req?: Request;
  actorUserId?: number | null;
  actorUsername?: string;
  target?: AuditTarget;
  result?: 'success' | 'failure';
  message?: string;
  metadata?: Record<string, unknown>;
}

function pickIp(req?: Request): string {
  if (!req) return '';
  const xf = (req.headers['x-forwarded-for'] || '') as string;
  const first = xf.split(',')[0]?.trim();
  return (first || req.ip || (req.socket && req.socket.remoteAddress) || '').toString().slice(0, 64);
}

function pickUa(req?: Request): string {
  if (!req) return '';
  return ((req.headers['user-agent'] as string) || '').slice(0, 512);
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const actorUserId = input.actorUserId ?? input.req?.user?.userId ?? null;
    const actorUsername =
      input.actorUsername ?? input.req?.user?.username ?? '';

    await knex('audit_logs').insert({
      category: input.category,
      action: input.action,
      actor_user_id: actorUserId,
      actor_username: actorUsername || '',
      target_type: input.target?.type || '',
      target_id: input.target?.id ?? null,
      target_label: (input.target?.label || '').slice(0, 255),
      result: input.result || 'success',
      message: (input.message || '').slice(0, 512),
      ip_address: pickIp(input.req),
      user_agent: pickUa(input.req),
      metadata: input.metadata ? JSON.stringify(input.metadata) : '',
    });
  } catch (err) {
    // Audit writes are best-effort; never propagate.
    // eslint-disable-next-line no-console
    console.warn('[audit] failed to record event:', (err as Error).message);
  }
}

/**
 * Fire-and-forget variant — defers the insert to the next tick so the caller
 * can `void recordAuditAsync(...)` without waiting on the DB.
 */
export function recordAuditAsync(input: AuditInput): void {
  setImmediate(() => {
    void recordAudit(input);
  });
}
