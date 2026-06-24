import { Router, Request, Response, NextFunction } from 'express';
import knex, { getDatabaseType } from '../database/connection.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { recordAuditAsync, AuditCategory } from '../services/audit-log.js';

export const auditRouter = Router();

// Anything in here is admin-only.
auditRouter.use(authenticate);
auditRouter.use(requirePermission('user:manage'));

/** Threshold for the "online" flag: last activity within this window = online. */
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

/**
 * Parse a DB timestamp safely. Handling differs by backend:
 *
 *  - MySQL (mysql2 driver): TIMESTAMP/DATETIME columns come back either as a
 *    JS Date in the server's local time or as a naïve string "YYYY-MM-DD
 *    HH:MM:SS" with no zone. Either way the value semantically represents the
 *    **MySQL server's local time** (NOW() returns local time). On the same
 *    host as Node, that's our local time too — let the JS engine parse it as
 *    local. (Forcing UTC here was the source of the +8h skew users saw.)
 *
 *  - SQLite (better-sqlite3): CURRENT_TIMESTAMP is documented as **UTC** and
 *    comes back as a naïve string. V8 would otherwise parse it as local time
 *    and skew the "online" calculation by the host offset, so we force-append
 *    'Z' for SQLite.
 */
function tsToMillis(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  const s = String(v);
  const isNaive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s);
  if (isNaive) {
    const iso = s.replace(' ', 'T');
    const suffix = getDatabaseType() === 'sqlite' ? 'Z' : '';
    return new Date(iso + suffix).getTime();
  }
  const n = new Date(s).getTime();
  return Number.isNaN(n) ? 0 : n;
}

/** Convert a DB timestamp to an ISO-8601 string with explicit UTC marker. */
function tsToIso(v: unknown): string | null {
  const ms = tsToMillis(v);
  return ms ? new Date(ms).toISOString() : null;
}

/**
 * GET /admin/audit/online
 * List all users with their last-seen / last-login info plus a computed
 * `online` flag. The UI polls this every ~30s.
 */
auditRouter.get('/online', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await knex('users as u')
      .select(
        'u.id',
        'u.username',
        'u.display_name',
        'u.email',
        'u.role',
        'u.last_seen_at',
        'u.last_login_at',
        'u.last_login_ip',
        'u.created_at',
      )
      .orderBy('u.last_seen_at', 'desc');

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

    const now = Date.now();
    const enriched = users.map((u: any) => {
      const lastSeenMs = tsToMillis(u.last_seen_at);
      const online = lastSeenMs > 0 && now - lastSeenMs < ONLINE_THRESHOLD_MS;
      return {
        ...u,
        last_seen_at: tsToIso(u.last_seen_at),
        last_login_at: tsToIso(u.last_login_at),
        created_at: tsToIso(u.created_at),
        online,
        roles: rolesByUser.get(u.id) || [],
      };
    });

    const onlineCount = enriched.filter((u) => u.online).length;
    res.json({
      threshold_ms: ONLINE_THRESHOLD_MS,
      total: enriched.length,
      online: onlineCount,
      users: enriched,
    });
  } catch (err) {
    next(err);
  }
});

const ALLOWED_CATEGORIES: AuditCategory[] = [
  'auth',
  'sync',
  'dictionary',
  'user_mgmt',
  'role_mgmt',
  'system',
];

/**
 * Build a base query honoring all common filters. Used by both /logs and /logs/export.
 */
function buildLogQuery(req: Request) {
  const q = knex('audit_logs as a').leftJoin('users as u', 'u.id', 'a.actor_user_id');

  const category = (req.query.category as string | undefined)?.trim();
  if (category && ALLOWED_CATEGORIES.includes(category as AuditCategory)) {
    q.where('a.category', category);
  }

  const action = (req.query.action as string | undefined)?.trim();
  if (action) q.where('a.action', action);

  const actor = (req.query.actor as string | undefined)?.trim();
  if (actor) {
    // Match either numeric id or username substring.
    const asNum = Number(actor);
    if (!Number.isNaN(asNum) && /^\d+$/.test(actor)) {
      q.where('a.actor_user_id', asNum);
    } else {
      q.whereLike('a.actor_username', `%${actor}%`);
    }
  }

  const result = (req.query.result as string | undefined)?.trim();
  if (result === 'success' || result === 'failure') {
    q.where('a.result', result);
  }

  const from = (req.query.from as string | undefined)?.trim();
  if (from) q.where('a.created_at', '>=', from);
  const to = (req.query.to as string | undefined)?.trim();
  if (to) q.where('a.created_at', '<=', to);

  const search = (req.query.q as string | undefined)?.trim();
  if (search) {
    const pat = `%${search}%`;
    q.where(function () {
      this.whereLike('a.actor_username', pat)
        .orWhereLike('a.target_label', pat)
        .orWhereLike('a.message', pat);
    });
  }

  return q;
}

/**
 * GET /admin/audit/logs — paginated list.
 */
auditRouter.get('/logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string) || 50));
    const offset = (page - 1) * pageSize;

    const countQuery = buildLogQuery(req).clone().count('* as total').first();
    const dataQuery = buildLogQuery(req)
      .clone()
      .select(
        'a.id',
        'a.category',
        'a.action',
        'a.actor_user_id',
        'a.actor_username',
        'u.display_name as actor_display_name',
        'a.target_type',
        'a.target_id',
        'a.target_label',
        'a.result',
        'a.message',
        'a.ip_address',
        'a.user_agent',
        'a.metadata',
        'a.created_at',
      )
      .orderBy('a.created_at', 'desc')
      .limit(pageSize)
      .offset(offset);

    const [countRow, rows] = await Promise.all([countQuery, dataQuery]);
    const total = Number((countRow as any)?.total ?? 0);

    const normalized = (rows as any[]).map((r) => ({ ...r, created_at: tsToIso(r.created_at) }));

    res.json({
      data: normalized,
      pagination: { page, pageSize, total },
    });
  } catch (err) {
    next(err);
  }
});

/** CSV escape: wrap in quotes and double-up embedded quotes. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * GET /admin/audit/logs/export — export current filter result as CSV.
 * Hard-capped at 100k rows; UTF-8 BOM so Excel won't mojibake Chinese.
 */
auditRouter.get('/logs/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const MAX_ROWS = 100_000;
    const rows = await buildLogQuery(req)
      .clone()
      .select(
        'a.id',
        'a.category',
        'a.action',
        'a.actor_username',
        'a.target_type',
        'a.target_id',
        'a.target_label',
        'a.result',
        'a.message',
        'a.ip_address',
        'a.user_agent',
        'a.metadata',
        'a.created_at',
      )
      .orderBy('a.created_at', 'desc')
      .limit(MAX_ROWS);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
    );

    // UTF-8 BOM so Excel reads it as UTF-8 (Chinese readable).
    res.write('﻿');
    const header = [
      'id',
      '时间',
      '类别',
      '动作',
      '操作人',
      '目标类型',
      '目标ID',
      '目标',
      '结果',
      '消息',
      'IP',
      'UA',
      '附加信息',
    ];
    res.write(header.join(',') + '\n');

    for (const r of rows as any[]) {
      const line = [
        r.id,
        r.created_at,
        r.category,
        r.action,
        r.actor_username,
        r.target_type,
        r.target_id ?? '',
        r.target_label,
        r.result,
        r.message,
        r.ip_address,
        r.user_agent,
        r.metadata,
      ]
        .map(csvCell)
        .join(',');
      res.write(line + '\n');
    }
    res.end();
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /admin/audit/logs?before=ISO_DATE
 * Empty body → wipe everything; with ?before → delete rows older than that timestamp.
 * The wipe itself is recorded as a fresh audit row (`system / audit.clear`).
 */
auditRouter.delete('/logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const before = (req.query.before as string | undefined)?.trim();

    const q = knex('audit_logs');
    if (before) q.where('created_at', '<', before);

    const deleted = await q.del();

    // Self-record the clear action (post-delete so it survives the wipe).
    recordAuditAsync({
      category: 'system',
      action: 'audit.clear',
      req,
      result: 'success',
      message: before ? `cleared rows before ${before}` : 'cleared all rows',
      metadata: { deleted_count: deleted, before: before || null },
    });

    res.json({ success: true, deleted });
  } catch (err) {
    next(err);
  }
});
