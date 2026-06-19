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
  // Run migrations. In production (dist/) the migrations directory may contain
  // both .js and .d.ts files (tsc emits both when declaration:true). Knex would
  // try to load the .d.ts as a migration and fail with "must have up/down".
  //
  // We list .js only when running compiled output. In dev (tsx) the directory
  // contains .ts files, so include both extensions. The .d.ts case is handled
  // by never emitting them in tsconfig (declaration: false).
  const inProduction = __dirname.includes(`${path.sep}dist${path.sep}`);
  const loadExtensions = inProduction ? ['.js'] : ['.js', '.ts'];

  await knex.migrate.latest({
    directory: path.join(__dirname, 'migrations'),
    loadExtensions,
  });
  console.log('[DB] Migrations complete');

  // Run seeds
  await knex.seed.run({
    directory: path.join(__dirname, 'seeds'),
    loadExtensions,
  });
  console.log('[DB] Seeds complete');
}

export default knex;
