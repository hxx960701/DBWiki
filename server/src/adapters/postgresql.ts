import pg from 'pg';
import type { DatabaseAdapter, ConnectionConfig, TableInfo, ColumnInfo, IndexInfo } from './types.js';

export class PostgreSQLAdapter implements DatabaseAdapter {
  private pool: pg.Pool;
  private schema: string;

  constructor(config: ConnectionConfig) {
    this.schema = config.extraConfig?.schema || 'public';
    this.pool = new pg.Pool({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database,
      connectionTimeoutMillis: 10000,
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      client.release();
      return true;
    } catch {
      return false;
    }
  }

  async getTables(): Promise<TableInfo[]> {
    const result = await this.pool.query(
      `SELECT t.tablename as table_name,
       obj_description((quote_ident(t.schemaname) || '.' || quote_ident(t.tablename))::regclass) as table_comment,
       COALESCE(s.n_live_tup, 0) as row_count
       FROM pg_catalog.pg_tables t
       LEFT JOIN pg_catalog.pg_stat_user_tables s ON s.schemaname = t.schemaname AND s.relname = t.tablename
       WHERE t.schemaname = $1
       ORDER BY t.tablename`,
      [this.schema]
    );
    return result.rows.map((r: any) => ({
      tableName: r.table_name,
      tableComment: r.table_comment || '',
      engine: 'PostgreSQL',
      rowCount: parseInt(r.row_count) || 0,
    }));
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const result = await this.pool.query(
      `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
       c.ordinal_position,
       col_description((quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass, c.ordinal_position) as column_comment,
       CASE WHEN pk.column_name IS NOT NULL THEN 'PRI'
            WHEN uk.column_name IS NOT NULL THEN 'UNI'
            WHEN fk.column_name IS NOT NULL THEN 'MUL'
            ELSE '' END as column_key
       FROM information_schema.columns c
       LEFT JOIN (
         SELECT ku.column_name FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $2 AND tc.table_schema = $1
       ) pk ON pk.column_name = c.column_name
       LEFT JOIN (
         SELECT ku.column_name FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
         WHERE tc.constraint_type = 'UNIQUE' AND tc.table_name = $2 AND tc.table_schema = $1
       ) uk ON uk.column_name = c.column_name
       LEFT JOIN (
         SELECT ku.column_name FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $2 AND tc.table_schema = $1
       ) fk ON fk.column_name = c.column_name
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
      [this.schema, tableName]
    );
    return result.rows.map((r: any) => ({
      columnName: r.column_name,
      columnType: r.data_type,
      isNullable: r.is_nullable === 'YES',
      columnKey: r.column_key || '',
      columnDefault: r.column_default,
      extra: '',
      columnComment: r.column_comment || '',
      ordinalPosition: r.ordinal_position,
    }));
  }

  async getIndexes(tableName: string): Promise<IndexInfo[]> {
    const result = await this.pool.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = $1 AND tablename = $2`,
      [this.schema, tableName]
    );
    return result.rows.map((r: any) => {
      const isUnique = r.indexdef.includes('UNIQUE');
      const typeMatch = r.indexdef.match(/USING (\w+)/);
      const colsMatch = r.indexdef.match(/\(([^)]+)\)/);
      const columns = colsMatch ? colsMatch[1].split(',').map((c: string) => c.trim().replace(/"/g, '')) : [];
      return {
        indexName: r.indexname,
        indexType: typeMatch ? typeMatch[1] : 'BTREE',
        columns,
        isUnique,
      };
    });
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }
}
