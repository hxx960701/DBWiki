import mssql from 'mssql';
import type { DatabaseAdapter, ConnectionConfig, TableInfo, ColumnInfo, IndexInfo, ProcedureInfo, ProcedureParamInfo, SampleRowsResult } from './types.js';

export class MSSQLAdapter implements DatabaseAdapter {
  private pool: mssql.ConnectionPool | null = null;
  private config: mssql.config;

  constructor(connectionConfig: ConnectionConfig) {
    this.config = {
      server: connectionConfig.host,
      port: connectionConfig.port,
      user: connectionConfig.username,
      password: connectionConfig.password,
      database: connectionConfig.database,
      options: {
        encrypt: connectionConfig.extraConfig?.encrypt ?? false,
        trustServerCertificate: connectionConfig.extraConfig?.trustServerCertificate ?? true,
      },
      connectionTimeout: 10000,
      requestTimeout: 30000,
    };
  }

  private async getPool(): Promise<mssql.ConnectionPool> {
    if (!this.pool) {
      this.pool = await new mssql.ConnectionPool(this.config).connect();
    }
    return this.pool;
  }

  async testConnection(): Promise<boolean> {
    const pool = await this.getPool();
    await pool.request().query('SELECT 1');
    return true;
  }

  async getTables(): Promise<TableInfo[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .query(`
        SELECT
          t.TABLE_NAME AS tableName,
          CAST(ep.value AS NVARCHAR(MAX)) AS tableComment
        FROM INFORMATION_SCHEMA.TABLES t
        LEFT JOIN sys.tables st ON st.name = t.TABLE_NAME
        LEFT JOIN sys.extended_properties ep
          ON ep.major_id = st.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
        WHERE t.TABLE_TYPE = 'BASE TABLE' AND t.TABLE_CATALOG = DB_NAME()
        ORDER BY t.TABLE_NAME
      `);
    return result.recordset.map((r: any) => ({
      tableName: r.tableName,
      tableComment: r.tableComment || '',
      engine: 'SQL Server',
      rowCount: 0,
    }));
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('tableName', mssql.NVarChar, tableName)
      .query(`
        SELECT
          c.COLUMN_NAME AS columnName,
          c.DATA_TYPE AS columnType,
          c.IS_NULLABLE AS isNullable,
          c.COLUMN_DEFAULT AS columnDefault,
          c.ORDINAL_POSITION AS ordinalPosition,
          CAST(ep.value AS NVARCHAR(MAX)) AS columnComment,
          CASE
            WHEN pk.COLUMN_NAME IS NOT NULL THEN 'PRI'
            WHEN uq.COLUMN_NAME IS NOT NULL THEN 'UNI'
            WHEN fk.COLUMN_NAME IS NOT NULL THEN 'MUL'
            ELSE ''
          END AS columnKey,
          CASE
            WHEN c.DATA_TYPE IN ('varchar', 'nvarchar', 'char', 'nchar', 'varbinary')
              THEN '(' + CAST(sc.max_length AS VARCHAR) + ')'
            WHEN c.DATA_TYPE IN ('decimal', 'numeric')
              THEN '(' + CAST(c.NUMERIC_PRECISION AS VARCHAR) + ',' + CAST(c.NUMERIC_SCALE AS VARCHAR) + ')'
            ELSE ''
          END AS extra
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN sys.columns sc
          ON sc.name = c.COLUMN_NAME
          AND sc.object_id = OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME)
        LEFT JOIN sys.extended_properties ep
          ON ep.major_id = sc.object_id AND ep.minor_id = sc.column_id AND ep.name = 'MS_Description'
        LEFT JOIN (
          SELECT ku.COLUMN_NAME
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
          WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_NAME = @tableName
        ) pk ON pk.COLUMN_NAME = c.COLUMN_NAME
        LEFT JOIN (
          SELECT ku.COLUMN_NAME
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
          WHERE tc.CONSTRAINT_TYPE = 'UNIQUE' AND tc.TABLE_NAME = @tableName
        ) uq ON uq.COLUMN_NAME = c.COLUMN_NAME
        LEFT JOIN (
          SELECT ku.COLUMN_NAME
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
          WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY' AND tc.TABLE_NAME = @tableName
        ) fk ON fk.COLUMN_NAME = c.COLUMN_NAME
        WHERE c.TABLE_NAME = @tableName
        ORDER BY c.ORDINAL_POSITION
      `);
    return result.recordset.map((r: any) => ({
      columnName: r.columnName,
      columnType: r.columnType + (r.extra || ''),
      isNullable: r.isNullable === 'YES',
      columnKey: r.columnKey || '',
      columnDefault: r.columnDefault,
      extra: r.extra || '',
      columnComment: r.columnComment || '',
      ordinalPosition: r.ordinalPosition,
    }));
  }

  async getIndexes(tableName: string): Promise<IndexInfo[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('tableName', mssql.NVarChar, tableName)
      .query(`
        SELECT
          i.name AS indexName,
          i.type_desc AS indexType,
          i.is_unique AS isUnique,
          c.name AS columnName
        FROM sys.indexes i
        INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE i.object_id = OBJECT_ID(@tableName) AND i.name IS NOT NULL
        ORDER BY i.name, ic.key_ordinal
      `);
    const indexMap = new Map<string, { columns: string[]; isUnique: boolean; indexType: string }>();
    for (const row of result.recordset) {
      const name = (row as any).indexName;
      if (!indexMap.has(name)) {
        indexMap.set(name, {
          columns: [],
          isUnique: !!(row as any).isUnique,
          indexType: (row as any).indexType || 'BTREE',
        });
      }
      indexMap.get(name)!.columns.push((row as any).columnName);
    }
    return Array.from(indexMap.entries()).map(([indexName, info]) => ({
      indexName,
      indexType: info.indexType,
      columns: info.columns,
      isUnique: info.isUnique,
    }));
  }

  async getProcedures(): Promise<ProcedureInfo[]> {
    const pool = await this.getPool();
    // type codes: P=procedure, FN=scalar function, IF=inline TVF, TF=table TVF, FS/FT=CLR
    const objResult = await pool.request().query(`
      SELECT
        o.object_id,
        o.name AS procedure_name,
        o.type AS type_code,
        o.type_desc AS type_desc,
        o.modify_date AS modify_date,
        m.definition AS definition,
        CAST(ep.value AS NVARCHAR(MAX)) AS procedure_comment
      FROM sys.objects o
      INNER JOIN sys.sql_modules m ON m.object_id = o.object_id
      LEFT JOIN sys.extended_properties ep
        ON ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
      WHERE o.type IN ('P','FN','IF','TF','FS','FT')
      ORDER BY o.name
    `);
    const objects = objResult.recordset as any[];
    if (objects.length === 0) return [];

    // Pull all parameters for procedures + functions
    const paramResult = await pool.request().query(`
      SELECT
        p.object_id,
        p.name AS param_name,
        TYPE_NAME(p.user_type_id) AS data_type,
        p.is_output,
        p.parameter_id
      FROM sys.parameters p
      ORDER BY p.object_id, p.parameter_id
    `);
    const paramMap = new Map<number, ProcedureParamInfo[]>();
    const returnTypeMap = new Map<number, string>();
    for (const row of paramResult.recordset as any[]) {
      // parameter_id = 0 is the function return value
      if (row.parameter_id === 0) {
        returnTypeMap.set(row.object_id, row.data_type || '');
        continue;
      }
      if (!paramMap.has(row.object_id)) paramMap.set(row.object_id, []);
      paramMap.get(row.object_id)!.push({
        name: row.param_name,
        type: row.data_type || '',
        mode: row.is_output ? 'OUT' : 'IN',
        default: null,
      });
    }

    return objects.map((o: any) => ({
      procedureName: o.procedure_name,
      procedureType: o.type_code.trim() === 'P' ? 'PROCEDURE' : 'FUNCTION',
      returnType: returnTypeMap.get(o.object_id) || '',
      parameters: paramMap.get(o.object_id) || [],
      definition: o.definition || '',
      procedureComment: o.procedure_comment || '',
      lastModified: o.modify_date ? new Date(o.modify_date).toISOString().split('T')[0] : '',
    }));
  }

  async getSampleRows(tableName: string, limit: number): Promise<SampleRowsResult> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('tableName', mssql.NVarChar, tableName)
      .input('limit', mssql.Int, limit)
      .query(`SELECT TOP (@limit) * FROM [${tableName}]`);
    const rows = result.recordset;
    if (rows.length === 0) return { columns: [], rows: [] };
    const columns = Object.keys(rows[0]);
    const rowArrays = rows.map((r: any) => columns.map(c => r[c]));
    return { columns, rows: rowArrays };
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
  }
}
