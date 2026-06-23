import pg from 'pg';
import type { DatabaseAdapter, ConnectionConfig, TableInfo, ColumnInfo, IndexInfo, ProcedureInfo, ProcedureParamInfo, SampleRowsResult } from './types.js';

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
    const client = await this.pool.connect();
    client.release();
    return true;
  }

  async getTables(): Promise<TableInfo[]> {
    const result = await this.pool.query(
      `SELECT t.tablename as table_name,
       obj_description((quote_ident(t.schemaname) || '.' || quote_ident(t.tablename))::regclass) as table_comment
       FROM pg_catalog.pg_tables t
       WHERE t.schemaname = $1
       ORDER BY t.tablename`,
      [this.schema]
    );
    return result.rows.map((r: any) => ({
      tableName: r.table_name,
      tableComment: r.table_comment || '',
      engine: 'PostgreSQL',
      rowCount: 0,
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

  async getProcedures(): Promise<ProcedureInfo[]> {
    const result = await this.pool.query(
      `SELECT
         p.proname AS procedure_name,
         p.prokind,
         pg_catalog.pg_get_functiondef(p.oid) AS definition,
         pg_catalog.pg_get_function_arguments(p.oid) AS args_def,
         pg_catalog.pg_get_function_result(p.oid) AS return_type,
         obj_description(p.oid, 'pg_proc') AS procedure_comment,
         p.prorettype::regtype::text AS return_type_simple,
         p.pronamespace::regnamespace::text AS schema_name
       FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = $1
         AND p.prokind IN ('f','p')   -- f=function, p=procedure (PG 11+). 'a'=aggregate, 'w'=window
         AND p.prorettype::regtype::text <> 'trigger'  -- skip triggers
       ORDER BY p.proname`,
      [this.schema],
    );

    return result.rows.map((r: any) => {
      // Parse pg_get_function_arguments into structured params
      const params: ProcedureParamInfo[] = [];
      if (r.args_def) {
        // Format: "arg1_name arg1_type, OUT arg2_name arg2_type, ..."
        // or with defaults: "arg1_name arg1_type DEFAULT 'val'"
        const parts = r.args_def.split(/\s*,\s*/);
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          // Detect mode prefix
          let mode = 'IN';
          let rest = trimmed;
          // Patterns: IN | OUT | INOUT | VARIADIC (case-insensitive)
          const modeMatch = trimmed.match(/^(IN\s+OUT|OUT|IN|VARIADIC)\s+(.+)/i);
          if (modeMatch) {
            mode = modeMatch[1].toUpperCase();
            rest = modeMatch[2];
          }
          // Split name and type (the type is everything after the first space, minus DEFAULT clause)
          const defaultMatch = rest.match(/^(\S+)\s+(.+?)(?:\s+DEFAULT\s+(.+))?$/i);
          if (defaultMatch) {
            params.push({
              name: defaultMatch[1],
              type: defaultMatch[2],
              mode,
              default: defaultMatch[3] || null,
            });
          } else {
            // Could be just a type (unlikely for named params, but handle edge case)
            params.push({
              name: rest,
              type: '',
              mode,
              default: null,
            });
          }
        }
      }

      return {
        procedureName: r.procedure_name,
        procedureType: r.prokind === 'p' ? 'PROCEDURE' : 'FUNCTION',
        returnType: r.return_type || r.return_type_simple || '',
        parameters: params,
        definition: r.definition || '',
        procedureComment: r.procedure_comment || '',
        lastModified: '',
      };
    });
  }

  async getSampleRows(tableName: string, limit: number): Promise<SampleRowsResult> {
    const result = await this.pool.query(`SELECT * FROM "${tableName}" LIMIT $1`, [limit]);
    const rows = result.rows;
    if (rows.length === 0) return { columns: [], rows: [] };
    const columns = Object.keys(rows[0]);
    const rowArrays = rows.map((r: any) => columns.map(c => r[c]));
    return { columns, rows: rowArrays };
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }
}
