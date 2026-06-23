import knex from '../database/connection.js';
import { readDatabaseConfig } from './system-config.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface MysqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** Tables and their per-batch row limit (lower for tables with large text columns). */
const MIGRATION_TABLES: Array<{ name: string; batchSize: number }> = [
  { name: 'users', batchSize: 500 },
  { name: 'projects', batchSize: 500 },
  { name: 'project_members', batchSize: 500 },
  { name: 'database_connections', batchSize: 500 },
  { name: 'permissions', batchSize: 500 },
  { name: 'roles', batchSize: 500 },
  { name: 'role_permissions', batchSize: 500 },
  { name: 'user_roles', batchSize: 500 },
  { name: 'project_role_bindings', batchSize: 500 },
  { name: 'dictionary_versions', batchSize: 50 },
  { name: 'dictionary_tables', batchSize: 100 },
  { name: 'dictionary_columns', batchSize: 100 },
  { name: 'dictionary_indexes', batchSize: 100 },
  { name: 'dictionary_publish_logs', batchSize: 100 },
  { name: 'dictionary_procedures', batchSize: 30 },  // definition can be very large
];

/**
 * Migrate all data from the active SQLite database to the target MySQL database.
 *
 * Safety: if any step fails, all MySQL tables created by this migration are
 * dropped so the target database is left in a clean state.
 */
export async function migrateData(mysqlConfig: MysqlConfig): Promise<void> {
  const Knex = (await import('knex')).default;
  const inProduction = __dirname.includes(`${path.sep}dist${path.sep}`);
  const loadExtensions = inProduction ? ['.js'] : ['.js', '.ts'];

  const mysqlKnex = Knex({
    client: 'mysql2',
    connection: {
      host: mysqlConfig.host,
      port: mysqlConfig.port,
      user: mysqlConfig.user,
      password: mysqlConfig.password,
      database: mysqlConfig.database,
    },
    migrations: {
      directory: path.join(__dirname, '../database/migrations'),
      loadExtensions,
    },
  });

  try {
    // 1. Run migrations on MySQL to create tables
    await mysqlKnex.migrate.latest();

    // 2. Copy data table by table
    for (const { name, batchSize } of MIGRATION_TABLES) {
      const rows = await knex(name).select('*');
      if (rows.length === 0) continue;

      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        await mysqlKnex(name).insert(chunk);
      }
      console.log(`[migrate] ${name}: ${rows.length} rows`);
    }
  } catch (err) {
    // Migration failed — drop ALL user tables + knex management tables to leave
    // the target database clean for a retry. This prevents data inconsistency.
    console.error('[migrate] Failed, rolling back MySQL tables...', err);
    try {
      const allTables = [
        ...MIGRATION_TABLES.map((t) => t.name),
        'knex_migrations',
        'knex_migrations_lock',
      ];
      // Drop in reverse order to respect FK constraints
      for (const name of allTables.reverse()) {
        await mysqlKnex.schema.dropTableIfExists(name);
      }
      console.log('[migrate] Rollback complete — all MySQL tables dropped');
    } catch (rollbackErr) {
      console.error('[migrate] Rollback also failed:', rollbackErr);
    }
    throw err;
  } finally {
    await mysqlKnex.destroy();
  }
}
