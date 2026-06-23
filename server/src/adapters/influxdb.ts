import { InfluxDB, type QueryApi } from '@influxdata/influxdb-client';
import type { DatabaseAdapter, ConnectionConfig, TableInfo, ColumnInfo, IndexInfo, ProcedureInfo } from './types.js';

export class InfluxDBAdapter implements DatabaseAdapter {
  private client: InfluxDB;
  private queryApi: QueryApi;
  private org: string;
  private bucket: string;

  constructor(config: ConnectionConfig) {
    const token = config.extraConfig?.token || config.password;
    this.org = config.extraConfig?.org || '';
    this.bucket = config.database;
    const url = `http://${config.host}:${config.port}`;
    this.client = new InfluxDB({ url, token });
    this.queryApi = this.client.getQueryApi(this.org);
  }

  async testConnection(): Promise<boolean> {
    const rows = await this.collectRows('SHOW MEASUREMENTS');
    return Array.isArray(rows);
  }

  private collectRows(query: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const rows: any[] = [];
      this.queryApi.queryRows(query, {
        next(row, tableMeta) {
          const obj = tableMeta.toObject(row);
          rows.push(obj);
        },
        error(err) {
          reject(err);
        },
        complete() {
          resolve(rows);
        },
      });
    });
  }

  async getTables(): Promise<TableInfo[]> {
    const rows = await this.collectRows(
      `from(bucket: "${this.bucket}") |> range(start: -1h) |> group() |> distinct(column: "_measurement")`
    );
    const measurements = new Set<string>();
    for (const row of rows) {
      if (row._value) measurements.add(row._value);
    }
    return Array.from(measurements).map(m => ({
      tableName: m,
      tableComment: '',
      engine: 'InfluxDB',
      rowCount: 0,
    }));
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const columns: ColumnInfo[] = [];
    let position = 1;

    // Field keys
    const fieldRows = await this.collectRows(
      `from(bucket: "${this.bucket}") |> range(start: -1h) |> filter(fn: (r) => r._measurement == "${tableName}") |> keys()`
    );
    const fieldKeys = new Set<string>();
    for (const row of fieldRows) {
      if (row._value && !row._value.startsWith('_') && row._value !== 'result' && row._value !== 'table') {
        fieldKeys.add(row._value);
      }
    }
    for (const key of fieldKeys) {
      columns.push({
        columnName: key,
        columnType: 'field',
        isNullable: true,
        columnKey: '',
        columnDefault: null,
        extra: '',
        columnComment: '',
        ordinalPosition: position++,
      });
    }

    // Tag keys
    try {
      const tagRows = await this.collectRows(
        `from(bucket: "${this.bucket}") |> range(start: -1h) |> filter(fn: (r) => r._measurement == "${tableName}") |> group() |> distinct(column: "_field") |> keys()`
      );
      const tagKeys = new Set<string>();
      for (const row of tagRows) {
        if (row._value && !row._value.startsWith('_') && row._value !== 'result' && row._value !== 'table' && !fieldKeys.has(row._value)) {
          tagKeys.add(row._value);
        }
      }
      for (const key of tagKeys) {
        columns.push({
          columnName: key,
          columnType: 'tag',
          isNullable: true,
          columnKey: '',
          columnDefault: null,
          extra: '',
          columnComment: '',
          ordinalPosition: position++,
        });
      }
    } catch {
      // Tag retrieval is best-effort
    }

    return columns;
  }

  async getIndexes(_tableName: string): Promise<IndexInfo[]> {
    return [];
  }

  async getProcedures(): Promise<ProcedureInfo[]> {
    return [];
  }

  async disconnect(): Promise<void> {
    // InfluxDB client does not require explicit close
  }
}
