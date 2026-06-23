import { createClient, type ClickHouseClient } from '@clickhouse/client';
import type { DatabaseAdapter, ConnectionConfig, TableInfo, ColumnInfo, IndexInfo, ProcedureInfo, SampleRowsResult } from './types.js';

export class ClickHouseAdapter implements DatabaseAdapter {
  private client: ClickHouseClient;
  private database: string;

  constructor(config: ConnectionConfig) {
    this.database = config.database;
    this.client = createClient({
      host: `http://${config.host}:${config.port}`,
      username: config.username,
      password: config.password,
      database: config.database,
      request_timeout: 10000,
    });
  }

  async testConnection(): Promise<boolean> {
    const result = await this.client.ping();
    return result.success;
  }

  async getTables(): Promise<TableInfo[]> {
    const result = await this.client.query({
      query: `
        SELECT name, engine, comment
        FROM system.tables
        WHERE database = {database: String}
        ORDER BY name
      `,
      query_params: { database: this.database },
      format: 'JSONEachRow',
    });
    const rows = await result.json<any>();
    return rows.map((r: any) => ({
      tableName: r.name,
      tableComment: r.comment || '',
      engine: r.engine || '',
      rowCount: 0,
    }));
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const result = await this.client.query({
      query: `
        SELECT
          name,
          type,
          is_in_partition_key,
          is_in_sorting_key,
          is_in_primary_key,
          is_in_sampling_key,
          default_kind,
          default_expression,
          comment,
          position
        FROM system.columns
        WHERE database = {database: String} AND table = {table: String}
        ORDER BY position
      `,
      query_params: { database: this.database, table: tableName },
      format: 'JSONEachRow',
    });
    const rows = await result.json<any>();
    return rows.map((r: any) => {
      const extraParts: string[] = [];
      if (r.is_in_primary_key) extraParts.push('PRIMARY KEY');
      if (r.is_in_partition_key) extraParts.push('PARTITION KEY');
      if (r.is_in_sorting_key) extraParts.push('SORTING KEY');
      if (r.default_kind) extraParts.push(`${r.default_kind} ${r.default_expression}`);

      return {
        columnName: r.name,
        columnType: r.type,
        isNullable: r.type.startsWith('Nullable'),
        columnKey: r.is_in_primary_key ? 'PRI' : '',
        columnDefault: r.default_expression || null,
        extra: extraParts.join(', '),
        columnComment: r.comment || '',
        ordinalPosition: r.position,
      };
    });
  }

  async getIndexes(tableName: string): Promise<IndexInfo[]> {
    try {
      const result = await this.client.query({
        query: `
          SELECT name, type, expr, granularity
          FROM system.data_skipping_indices
          WHERE database = {database: String} AND table = {table: String}
          ORDER BY name
        `,
        query_params: { database: this.database, table: tableName },
        format: 'JSONEachRow',
      });
      const rows = await result.json<any>();
      return rows.map((r: any) => ({
        indexName: r.name,
        indexType: r.type || 'minmax',
        columns: typeof r.expr === 'string' ? [r.expr] : [],
        isUnique: false,
      }));
    } catch {
      return [];
    }
  }

  async getProcedures(): Promise<ProcedureInfo[]> {
    return [];
  }

  async getSampleRows(tableName: string, limit: number): Promise<SampleRowsResult> {
    const result = await this.client.query({
      query: `SELECT * FROM {table:Identifier} LIMIT {limit:UInt32}`,
      query_params: { table: tableName, limit },
      format: 'JSONEachRow',
    });
    const rows = await result.json<any>();
    if (rows.length === 0) return { columns: [], rows: [] };
    const columns = Object.keys(rows[0]);
    const rowArrays = rows.map((r: any) => columns.map(c => r[c]));
    return { columns, rows: rowArrays };
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }
}
