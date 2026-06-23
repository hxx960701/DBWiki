import mysql from 'mysql2/promise';
import type { DatabaseAdapter, ConnectionConfig, TableInfo, ColumnInfo, IndexInfo, ProcedureInfo, ProcedureParamInfo } from './types.js';

export class MySQLAdapter implements DatabaseAdapter {
  protected pool: mysql.Pool;
  protected dbName: string;

  constructor(config: ConnectionConfig) {
    this.dbName = config.database;
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database,
      connectTimeout: 10000,
    });
  }

  async testConnection(): Promise<boolean> {
    const conn = await this.pool.getConnection();
    conn.release();
    return true;
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
      engine: r.engine || '',
      rowCount: 0,
    }));
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const [rows] = await this.pool.query(
      `SELECT COLUMN_NAME as columnName, COLUMN_TYPE as columnType,
       IS_NULLABLE as isNullable, COLUMN_KEY as columnKey,
       COLUMN_DEFAULT as columnDefault, EXTRA as extra,
       COLUMN_COMMENT as columnComment, ORDINAL_POSITION as ordinalPosition
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [this.dbName, tableName]
    );
    return (rows as any[]).map(r => ({
      columnName: r.columnName,
      columnType: r.columnType,
      isNullable: r.isNullable === 'YES',
      columnKey: r.columnKey || '',
      columnDefault: r.columnDefault,
      extra: r.extra || '',
      columnComment: r.columnComment || '',
      ordinalPosition: r.ordinalPosition,
    }));
  }

  async getIndexes(tableName: string): Promise<IndexInfo[]> {
    const [rows] = await this.pool.query(`SHOW INDEX FROM \`${tableName}\``);
    const indexMap = new Map<string, { columns: string[]; isUnique: boolean; indexType: string }>();

    for (const row of rows as any[]) {
      const name = row.Key_name;
      if (!indexMap.has(name)) {
        indexMap.set(name, {
          columns: [],
          isUnique: !row.Non_unique,
          indexType: row.Index_type || 'BTREE',
        });
      }
      indexMap.get(name)!.columns.push(row.Column_name);
    }

    return Array.from(indexMap.entries()).map(([indexName, info]) => ({
      indexName,
      indexType: info.indexType,
      columns: info.columns,
      isUnique: info.isUnique,
    }));
  }

  async getProcedures(): Promise<ProcedureInfo[]> {
    // Routines (procedures + functions). ROUTINE_DEFINITION can be NULL when
    // the connected user lacks privileges; we fall back to SHOW CREATE in that case.
    const [routineRows] = await this.pool.query(
      `SELECT ROUTINE_NAME, ROUTINE_TYPE, DTD_IDENTIFIER, ROUTINE_DEFINITION,
              ROUTINE_COMMENT, LAST_ALTERED
       FROM information_schema.ROUTINES
       WHERE ROUTINE_SCHEMA = ?
       ORDER BY ROUTINE_NAME`,
      [this.dbName],
    );
    const routines = routineRows as any[];
    if (routines.length === 0) return [];

    // Pull all params for the schema in one query, then group.
    const [paramRows] = await this.pool.query(
      `SELECT SPECIFIC_NAME, ROUTINE_TYPE, PARAMETER_NAME, DATA_TYPE,
              PARAMETER_MODE, ORDINAL_POSITION
       FROM information_schema.PARAMETERS
       WHERE SPECIFIC_SCHEMA = ?
       ORDER BY SPECIFIC_NAME, ORDINAL_POSITION`,
      [this.dbName],
    );
    const paramMap = new Map<string, ProcedureParamInfo[]>();
    for (const row of paramRows as any[]) {
      // ORDINAL_POSITION = 0 is the function return — skip in param list
      if (!row.PARAMETER_NAME) continue;
      const key = `${row.ROUTINE_TYPE}:${row.SPECIFIC_NAME}`;
      if (!paramMap.has(key)) paramMap.set(key, []);
      paramMap.get(key)!.push({
        name: row.PARAMETER_NAME,
        type: row.DATA_TYPE || '',
        mode: row.PARAMETER_MODE || 'IN',
        default: null,
      });
    }

    const out: ProcedureInfo[] = [];
    for (const r of routines) {
      let definition: string = r.ROUTINE_DEFINITION || '';
      if (!definition) {
        // Fall back to SHOW CREATE — surrounds the definition with extra metadata,
        // but at least gives us the body when information_schema returns NULL.
        try {
          const stmt = r.ROUTINE_TYPE === 'FUNCTION'
            ? `SHOW CREATE FUNCTION \`${r.ROUTINE_NAME}\``
            : `SHOW CREATE PROCEDURE \`${r.ROUTINE_NAME}\``;
          const [rows] = await this.pool.query(stmt);
          const row = (rows as any[])[0];
          definition = row?.['Create Function'] || row?.['Create Procedure'] || '';
        } catch {
          definition = '';
        }
      }
      out.push({
        procedureName: r.ROUTINE_NAME,
        procedureType: r.ROUTINE_TYPE,
        returnType: r.ROUTINE_TYPE === 'FUNCTION' ? (r.DTD_IDENTIFIER || '') : '',
        parameters: paramMap.get(`${r.ROUTINE_TYPE}:${r.ROUTINE_NAME}`) || [],
        definition,
        procedureComment: r.ROUTINE_COMMENT || '',
        lastModified: r.LAST_ALTERED ? String(r.LAST_ALTERED) : '',
      });
    }
    return out;
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }
}
