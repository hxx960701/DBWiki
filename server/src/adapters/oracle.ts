import oracledb from 'oracledb';
import type { DatabaseAdapter, ConnectionConfig, TableInfo, ColumnInfo, IndexInfo } from './types.js';

/** Default timeout (ms) for pool creation and connection test. */
const CONNECT_TIMEOUT_MS = 15_000;

/** Race a promise against a timeout, throwing if it takes too long. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/**
 * Append Oracle Easy Connect timeout parameters to the connect string so the
 * driver itself gives up quickly on unreachable hosts.
 */
function injectConnectTimeout(connectString: string, ms: number): string {
  const separator = connectString.includes('?') ? '&' : '?';
  return `${connectString}${separator}transport_connect_timeout=${ms}&retry_count=0`;
}

export class OracleAdapter implements DatabaseAdapter {
  private pool: oracledb.Pool | null = null;
  private connectConfig: oracledb.PoolAttributes;
  private owner: string;
  private connectTimeoutMs: number;

  constructor(config: ConnectionConfig) {
    this.owner = config.username.toUpperCase();
    this.connectTimeoutMs = config.extraConfig?.connectTimeout
      ? Number(config.extraConfig.connectTimeout)
      : CONNECT_TIMEOUT_MS;

    const rawConnectString = config.extraConfig?.connectString
      || `${config.host}:${config.port}/${config.database}`;

    this.connectConfig = {
      user: config.username,
      password: config.password,
      connectString: injectConnectTimeout(rawConnectString, this.connectTimeoutMs),
      poolMin: 1,
      poolMax: 5,
      poolTimeout: 10,
      queueTimeout: 10_000,
    };
  }

  private async getPool(): Promise<oracledb.Pool> {
    if (!this.pool) {
      this.pool = await withTimeout(
        oracledb.createPool(this.connectConfig),
        this.connectTimeoutMs,
        'Oracle pool creation',
      );
    }
    return this.pool;
  }

  async testConnection(): Promise<boolean> {
    const pool = await this.getPool();
    const connection = await withTimeout(
      pool.getConnection(),
      this.connectTimeoutMs,
      'Oracle connection acquisition',
    );
    try {
      await connection.execute('SELECT 1 FROM DUAL');
      return true;
    } finally {
      await connection.close();
    }
  }

  async getTables(): Promise<TableInfo[]> {
    const pool = await this.getPool();
    const connection = await withTimeout(
      pool.getConnection(),
      this.connectTimeoutMs,
      'Oracle connection acquisition',
    );
    try {
      const result = await connection.execute(
        `SELECT t.TABLE_NAME, tc.COMMENTS
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
        rowCount: 0,
      }));
    } finally {
      await connection.close();
    }
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const pool = await this.getPool();
    const connection = await withTimeout(
      pool.getConnection(),
      this.connectTimeoutMs,
      'Oracle connection acquisition',
    );
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
    const connection = await withTimeout(
      pool.getConnection(),
      this.connectTimeoutMs,
      'Oracle connection acquisition',
    );
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
