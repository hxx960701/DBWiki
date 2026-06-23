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

/**
 * Migrate all data from the active SQLite database to the target MySQL database.
 * Steps:
 *  1. Connect to MySQL, run knex migrations to create schema
 *  2. Read each table from SQLite, batch-insert into MySQL
 *  3. Update config to switch to MySQL
 */
export async function migrateData(mysqlConfig: MysqlConfig): Promise<void> {
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    database: mysqlConfig.database,
    multipleStatements: true,
    connectTimeout: 15000,
  });

  try {
    // Import and create knex instance for MySQL
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
      // Run migrations on MySQL to create tables
      await mysqlKnex.migrate.latest();

      // Get list of all user tables (SQLite)
      const tables = ['users', 'projects', 'project_members', 'database_connections',
        'dictionary_versions', 'dictionary_tables', 'dictionary_columns',
        'dictionary_indexes', 'dictionary_publish_logs', 'dictionary_procedures',
        'user_roles', 'role_permissions', 'permissions', 'roles'];

      for (const table of tables) {
        const rows = await knex(table).select('*');
        if (rows.length === 0) continue;

        // Batch insert in chunks of 500
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          await mysqlKnex(table).insert(chunk);
        }
        console.log(`[migrate] ${table}: ${rows.length} rows`);
      }
    } finally {
      await mysqlKnex.destroy();
    }
  } finally {
    await conn.end();
  }
}
