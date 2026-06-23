import Knex from 'knex';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read optional database config for MySQL support
interface DbConfig {
  type: 'sqlite' | 'mysql';
  mysql?: { host: string; port: number; database: string; user: string; password: string };
}

let dbConfig: DbConfig = { type: 'sqlite' };
const configPath = path.resolve('./data/database-config.json');
if (fs.existsSync(configPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (raw.type === 'mysql') dbConfig = raw;
  } catch { /* ignore */ }
}

let knexInstance: Knex.Knex;

if (dbConfig.type === 'mysql' && dbConfig.mysql) {
  knexInstance = Knex({
    client: 'mysql2',
    connection: {
      host: dbConfig.mysql.host,
      port: dbConfig.mysql.port,
      user: dbConfig.mysql.user,
      password: dbConfig.mysql.password,
      database: dbConfig.mysql.database,
    },
    pool: { min: 2, max: 10 },
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      extension: 'js',
    },
  });
} else {
  const dbPath = process.env.DB_PATH || './data/dbwiki.sqlite3';
  const dataDir = path.dirname(path.resolve(dbPath));
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  knexInstance = Knex({
    client: 'better-sqlite3',
    connection: { filename: dbPath },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn: any, cb: Function) => {
        conn.pragma('journal_mode = WAL');
        conn.pragma('foreign_keys = ON');
        cb(null, conn);
      },
    },
  });
}

export const knex = knexInstance;

export function getDatabaseType(): string {
  return dbConfig.type;
}

export async function initializeDatabase() {
  const inProduction = __dirname.includes(`${path.sep}dist${path.sep}`);
  const loadExtensions = inProduction ? ['.js'] : ['.js', '.ts'];

  await knex.migrate.latest({
    directory: path.join(__dirname, 'migrations'),
    loadExtensions,
  });
  console.log('[DB] Migrations complete');

  await knex.seed.run({
    directory: path.join(__dirname, 'seeds'),
    loadExtensions,
  });
  console.log('[DB] Seeds complete');
}

export default knex;
