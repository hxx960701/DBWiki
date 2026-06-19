import oracledb from 'oracledb';
import type { DatabaseAdapter, ConnectionConfig, TableInfo, ColumnInfo, IndexInfo } from './types.js';

export class OracleAdapter implements DatabaseAdapter {
  private pool: oracledb.Pool | null = null;
  private connectConfig: oracledb.PoolAttributes;
  private owner: string;

  constructor(config: ConnectionConfig) {
    this.owner = config.username.toUpperCase();
    this.connectConfig = {
      user: config.username,
      password: config.password,
      connectString: config.extraConfig?.connectString
        || `${config.host}:${config.port}/${config.database}`,
      poolMin: 2,
      poolMax: 10,
      poolTimeout: 60,
    };
  }

  private async getPool(): Promise<oracledb.Pool> {
    if (!this.pool) {
      this.pool = await oracledb.createPool(this.connectConfig);
    }
    return this.pool;
  }

  async testConnection(): Promise<boolean> {
    let connection: oracledb.Connection | null = null;
    try {
      const pool = await this.getPool();
      connection = await pool.getConnection();
      await connection.execute('SELECT 1 FROM DUAL');
      await connection.close();
      return true;
    } catch {
      if (connection) {
        try { await connection.close(); } catch { /* ignore */ }
      }
      return false;
    }
  }

  async getTables(): Promise<TableInfo[]> {
    const pool = await this.getPool();
    const connection = await pool.getConnection();
    try {
      const result = await connection.execute(
        `SELECT t.TABLE_NAME, tc.COMMENTS, t.NUM_ROWS
         FROM ALL_TABLES t
         LEFT JOIN ALL_TAB_COMMENTS tc
           ON t.OWNER = tc.OWNER AND t.TABLE_NAME = tc.TABLE_NAME AND tc.TABLE_TYPE = 'TABLE'
         WHERE t.OWNER = :owner
         ORDER BY t.TABLE_NAME`,
        { owner: this.owner },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      return (result.rows as any[]).map(r => ({
        tableName: r.TABLE_NAME,
        tableComment: r.COMMENTS || '',
        engine: 'Oracle',
        rowCount: r.NUM_ROWS || 0,
      }));
    } finally {
      await connection.close();
    }
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const pool = await this.getPool();
    const connection = await pool.getConnection();
    try {
      const result = await connection.execute(
        `SELECT
           c.COLUMN_NAME,
           c.DATA_TYPE,
           c.NULLABLE,
           c.DATA_DEFAULT,
           c.COLUMN_ID,
           cc.COMMENTS,
           CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 'PRI'
                WHEN uq.COLUMN_NAME IS NOT NULL THEN 'UNI'
                WHEN fk.COLUMN_NAME IS NOT NULL THEN 'MUL'
                ELSE '' END AS COLUMN_KEY,
           c.DATA_LENGTH,
           c.DATA_PRECISION,
           c.DATA_SCALE,
           c.CHAR_LENGTH
         FROM ALL_TAB_COLUMNS c
         LEFT JOIN ALL_COL_COMMENTS cc
           ON c.OWNER = cc.OWNER AND c.TABLE_NAME = cc.TABLE_NAME AND c.COLUMN_NAME = cc.COLUMN_NAME
         LEFT JOIN (
           SELECT acc.COLUMN_NAME
           FROM ALL_CONS_COLUMNS acc
           JOIN ALL_CONSTRAINTS ac ON acc.CONSTRAINT_NAME = ac.CONSTRAINT_NAME AND acc.OWNER = ac.OWNER
           WHERE ac.CONSTRAINT_TYPE = 'P' AND acc.OWNER = :owner AND acc.TABLE_NAME = :tableName1
         ) pk ON pk.COLUMN_NAME = c.COLUMN_NAME
         LEFT JOIN (
           SELECT acc.COLUMN_NAME
           FROM ALL_CONS_COLUMNS acc
           JOIN ALL_CONSTRAINTS ac ON acc.CONSTRAINT_NAME = ac.CONSTRAINT_NAME AND acc.OWNER = ac.OWNER
           WHERE ac.CONSTRAINT_TYPE = 'U' AND acc.OWNER = :owner AND acc.TABLE_NAME = :tableName2
         ) uq ON uq.COLUMN_NAME = c.COLUMN_NAME
         LEFT JOIN (
           SELECT acc.COLUMN_NAME
           FROM ALL_CONS_COLUMNS acc
           JOIN ALL_CONSTRAINTS ac ON acc.CONSTRAINT_NAME = ac.CONSTRAINT_NAME AND acc.OWNER = ac.OWNER
           WHERE ac.CONSTRAINT_TYPE = 'R' AND acc.OWNER = :owner AND acc.TABLE_NAME = :tableName3
         ) fk ON fk.COLUMN_NAME = c.COLUMN_NAME
         WHERE c.OWNER = :owner AND c.TABLE_NAME = :tableName
         ORDER BY c.COLUMN_ID`,
        {
          owner: this.owner,
          tableName,
          tableName1: tableName,
          tableName2: tableName,
          tableName3: tableName,
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      return (result.rows as any[]).map(r => {
        let columnType = r.DATA_TYPE;
        if (r.DATA_PRECISION != null && r.DATA_SCALE != null) {
          columnType += `(${r.DATA_PRECISION},${r.DATA_SCALE})`;
        } else if (r.DATA_LENGTH) {
          columnType += `(${r.DATA_LENGTH})`;
        }
        return {
          columnName: r.COLUMN_NAME,
          columnType,
          isNullable: r.NULLABLE === 'Y',
          columnKey: r.COLUMN_KEY || '',
          columnDefault: r.DATA_DEFAULT ? String(r.DATA_DEFAULT).trim() : null,
          extra: '',
          columnComment: r.COMMENTS || '',
          ordinalPosition: r.COLUMN_ID,
        };
      });
    } finally {
      await connection.close();
    }
  }

  async getIndexes(tableName: string): Promise<IndexInfo[]> {
    const pool = await this.getPool();
    const connection = await pool.getConnection();
    try {
      const result = await connection.execute(
        `SELECT
           i.INDEX_NAME,
           i.INDEX_TYPE,
           i.UNIQUENESS,
           ic.COLUMN_NAME
         FROM ALL_INDEXES i
         JOIN ALL_IND_COLUMNS ic
           ON i.INDEX_NAME = ic.INDEX_NAME AND i.OWNER = ic.INDEX_OWNER
         WHERE i.TABLE_OWNER = :owner AND i.TABLE_NAME = :tableName
         ORDER BY i.INDEX_NAME, ic.COLUMN_POSITION`,
        { owner: this.owner, tableName },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const indexMap = new Map<string, { columns: string[]; isUnique: boolean; indexType: string }>();
      for (const row of result.rows as any[]) {
        const name = row.INDEX_NAME;
        if (!indexMap.has(name)) {
          indexMap.set(name, {
            columns: [],
            isUnique: row.UNIQUENESS === 'UNIQUE',
            indexType: row.INDEX_TYPE || 'BTREE',
          });
        }
        indexMap.get(name)!.columns.push(row.COLUMN_NAME);
      }
      return Array.from(indexMap.entries()).map(([indexName, info]) => ({
        indexName,
        indexType: info.indexType,
        columns: info.columns,
        isUnique: info.isUnique,
      }));
    } finally {
      await connection.close();
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close(0);
      this.pool = null;
    }
  }
}
