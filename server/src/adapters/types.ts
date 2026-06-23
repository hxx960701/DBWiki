export interface TableInfo {
  tableName: string;
  tableComment: string;
  engine: string;
  rowCount: number;
}

export interface ColumnInfo {
  columnName: string;
  columnType: string;
  isNullable: boolean;
  columnKey: string;
  columnDefault: string | null;
  extra: string;
  columnComment: string;
  ordinalPosition: number;
}

export interface IndexInfo {
  indexName: string;
  indexType: string;
  columns: string[];
  isUnique: boolean;
}

/** A single parameter of a stored procedure / function. */
export interface ProcedureParamInfo {
  name: string;
  type: string;
  /** IN | OUT | INOUT | RETURN — RETURN is used for function return slots when surfaced as a parameter row. */
  mode: string;
  default: string | null;
}

export interface ProcedureInfo {
  procedureName: string;
  /** 'PROCEDURE' or 'FUNCTION'. */
  procedureType: string;
  /** Empty string for procedures. */
  returnType: string;
  parameters: ProcedureParamInfo[];
  /** Full DDL / source body. */
  definition: string;
  procedureComment: string;
  /** Database-native modification timestamp formatted as a string ('' if unsupported). */
  lastModified: string;
}

export interface DatabaseAdapter {
  testConnection(): Promise<boolean>;
  getTables(): Promise<TableInfo[]>;
  getColumns(tableName: string): Promise<ColumnInfo[]>;
  getIndexes(tableName: string): Promise<IndexInfo[]>;
  /**
   * Stored procedures / functions in the connected schema.
   * Adapters whose backend has no procedure concept (StarRocks, ClickHouse,
   * InfluxDB) return an empty array — they MUST implement this so the sync
   * pipeline can call it unconditionally.
   */
  getProcedures(): Promise<ProcedureInfo[]>;
  disconnect(): Promise<void>;
}

export interface ConnectionConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  extraConfig?: Record<string, any>;
}
