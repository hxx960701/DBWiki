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

export interface DatabaseAdapter {
  testConnection(): Promise<boolean>;
  getTables(): Promise<TableInfo[]>;
  getColumns(tableName: string): Promise<ColumnInfo[]>;
  getIndexes(tableName: string): Promise<IndexInfo[]>;
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
