import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.resolve('./data/database-config.json');

export interface DatabaseConfig {
  type: 'sqlite' | 'mysql';
  mysql: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
}

const defaultConfig: DatabaseConfig = {
  type: 'sqlite',
  mysql: {
    host: '',
    port: 3306,
    database: '',
    user: '',
    password: '',
  },
};

export function readDatabaseConfig(): DatabaseConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }
  return { ...defaultConfig };
}

export function writeDatabaseConfig(config: DatabaseConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}
