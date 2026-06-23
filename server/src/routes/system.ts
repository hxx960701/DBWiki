import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import knex from '../database/connection.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/error-handler.js';
import { readDatabaseConfig, writeDatabaseConfig } from '../services/system-config.js';
import { migrateData } from '../services/migration.js';

export const systemRouter = Router();

systemRouter.use(authenticate);
systemRouter.use(requirePermission('user:manage'));

// GET /admin/system/info — system information
systemRouter.get('/info', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = readDatabaseConfig();
    const [userCount, connectionCount, versionCount, tableCount] = await Promise.all([
      knex('users').count('* as c').first(),
      knex('database_connections').count('* as c').first(),
      knex('dictionary_versions').count('* as c').first(),
      knex('dictionary_tables').count('* as c').first(),
    ]);
    res.json({
      database_type: config.type,
      users: Number((userCount as any)?.c ?? 0),
      connections: Number((connectionCount as any)?.c ?? 0),
      versions: Number((versionCount as any)?.c ?? 0),
      tables: Number((tableCount as any)?.c ?? 0),
    });
  } catch (error) {
    next(error);
  }
});

// GET /admin/system/database-config — return current DB config (password masked)
systemRouter.get('/database-config', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = readDatabaseConfig();
    res.json({
      type: config.type,
      mysql: {
        host: config.mysql.host,
        port: config.mysql.port,
        database: config.mysql.database,
        user: config.mysql.user,
        password: config.mysql.password ? '••••••' : '',
      },
    });
  } catch (error) {
    next(error);
  }
});

const dbConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().optional().default(''),
});

// PUT /admin/system/database-config — save MySQL config
systemRouter.put(
  '/database-config',
  validate(dbConfigSchema),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = readDatabaseConfig();
      // Preserve existing password if masked
      const password = req.body.password === '••••••' ? config.mysql.password : req.body.password;
      config.mysql = { ...req.body, password };
      writeDatabaseConfig(config);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

// POST /admin/system/test-mysql — test MySQL connection
systemRouter.post('/test-mysql', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = readDatabaseConfig();
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      connectTimeout: 10000,
    });
    await conn.ping();
    await conn.end();
    res.json({ success: true, message: '连接成功' });
  } catch (err: any) {
    res.json({ success: false, message: err.message || '连接失败' });
  }
});

// POST /admin/system/migrate — migrate SQLite → MySQL
systemRouter.post('/migrate', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = readDatabaseConfig();
    if (config.type !== 'sqlite') {
      throw new AppError('当前数据库不是 SQLite，无需迁移', 400);
    }
    if (!config.mysql.host || !config.mysql.database) {
      throw new AppError('请先配置 MySQL 连接', 400);
    }
    await migrateData(config.mysql);
    config.type = 'mysql';
    writeDatabaseConfig(config);
    res.json({ success: true, message: '迁移完成。请重启服务使新数据库生效。' });
  } catch (error) {
    next(error);
  }
});
