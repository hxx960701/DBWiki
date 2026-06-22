import type { ConnectionConfig, TableInfo, IndexInfo } from './types.js';
import { MySQLAdapter } from './mysql.js';

export class StarRocksAdapter extends MySQLAdapter {
  constructor(config: ConnectionConfig) {
    super({
      ...config,
      port: config.port || 9030,
    });
  }

  async getTables(): Promise<TableInfo[]> {
    const [rows] = await this.pool.query(
      `SELECT TABLE_NAME as tableName, TABLE_COMMENT as tableComment,
       ENGINE as engine
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [this.dbName]
    );
    return (rows as any[]).map(r => ({
      tableName: r.tableName,
      tableComment: r.tableComment || '',
      engine: r.engine || 'StarRocks',
      rowCount: 0,
    }));
  }

  async getIndexes(tableName: string): Promise<IndexInfo[]> {
    try {
      const [rows] = await this.pool.query(
        `SELECT INDEX_NAME, INDEX_TYPE, COLUMNS
         FROM information_schema.indexes
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [this.dbName, tableName]
      );
      return (rows as any[]).map(r => ({
        indexName: r.INDEX_NAME,
        indexType: r.INDEX_TYPE || 'BITMAP',
        columns: r.COLUMNS ? r.COLUMNS.split(',').map((c: string) => c.trim()) : [],
        isUnique: false,
      }));
    } catch {
      return [];
    }
  }
}
