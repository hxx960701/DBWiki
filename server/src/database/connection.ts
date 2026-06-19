import Knex from 'knex';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.DB_PATH || './data/dbwiki.sqlite3';

// Ensure data directory exists
const dataDir = path.dirname(path.resolve(dbPath));
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const knex = Knex({
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

export async function initializeDatabase() {
  // Run migrations
  await knex.migrate.latest({
    directory: path.join(__dirname, 'migrations'),
  });
  console.log('[DB] Migrations complete');

  // Run seeds
  await knex.seed.run({
    directory: path.join(__dirname, 'seeds'),
  });
  console.log('[DB] Seeds complete');
}

export default knex;
