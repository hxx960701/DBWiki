/**
 * Generate SQL statements from table relations.
 *
 * Given a set of Relation objects and the dictionary table metadata, produces:
 *   - ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY  (for 1:1 / 1:N)
 *   - CREATE TABLE for junction tables              (for N:M)
 *   - SELECT … JOIN query templates
 */

import type { Relation } from '../api/relations';

interface ColumnInfo {
  column_name: string;
  column_type: string;
  is_nullable: string;
  column_key: string;
  column_default: string | null;
  extra: string;
  column_comment: string;
}

interface TableInfo {
  table_name: string;
  table_comment: string;
  engine: string;
  columns: ColumnInfo[];
}

/** Quote a MySQL identifier with backticks. */
function q(name: string): string {
  return `\`${name}\``;
}

/** Build a foreign-key constraint name: fk_<source>_<col>_<target>. */
function fkName(source: string, sourceCol: string, target: string): string {
  return `fk_${source}_${sourceCol}_${target}`;
}

/** Build a junction table name for N:M: j_<tableA>_<tableB>. */
function junctionName(tableA: string, tableB: string): string {
  return [tableA, tableB].sort().join('_');
}

/** Find a column's type from table metadata. */
function findColumnType(tables: TableInfo[], tableName: string, columnName: string): string | null {
  const table = tables.find((t) => t.table_name === tableName);
  if (!table) return null;
  const col = table.columns.find((c) => c.column_name === columnName);
  return col ? col.column_type : null;
}

/** Get the primary key column(s) of a table. */
function getPrimaryKeyColumns(tables: TableInfo[], tableName: string): string[] {
  const table = tables.find((t) => t.table_name === tableName);
  if (!table) return [];
  return table.columns.filter((c) => c.column_key === 'PRI').map((c) => c.column_name);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GeneratedSQL {
  /** Category label, e.g. "外键约束", "中间表", "查询模板" */
  category: string;
  /** A single SQL statement with a short description. */
  statements: Array<{ description: string; sql: string }>;
}

/**
 * Generate all SQL from a list of relations.
 */
export function generateRelationSQL(relations: Relation[], tables: TableInfo[]): GeneratedSQL[] {
  const result: GeneratedSQL[] = [];

  // --- 1. Foreign key constraints (1:1, 1:N) ---
  const fkStatements: Array<{ description: string; sql: string }> = [];
  const junctionStatements: Array<{ description: string; sql: string }> = [];
  const seenJunctions = new Set<string>();

  for (const rel of relations) {
    if (rel.relation_type === '1:1' || rel.relation_type === '1:N') {
      const constraintName = fkName(rel.source_table_name, rel.source_column_name, rel.target_table_name);
      const sql = [
        `ALTER TABLE ${q(rel.source_table_name)}`,
        `  ADD CONSTRAINT ${q(constraintName)}`,
        `  FOREIGN KEY (${q(rel.source_column_name)})`,
        `  REFERENCES ${q(rel.target_table_name)}(${q(rel.target_column_name)});`,
      ].join('\n');

      const typeLabel = rel.relation_type === '1:1' ? '一对一' : '一对多';
      fkStatements.push({
        description: `${rel.source_table_name}.${rel.source_column_name} → ${rel.target_table_name}.${rel.target_column_name} (${typeLabel})`,
        sql,
      });
    }

    if (rel.relation_type === 'N:M') {
      const jName = junctionName(rel.source_table_name, rel.target_table_name);
      if (seenJunctions.has(jName)) continue;
      seenJunctions.add(jName);

      // Determine column types for the junction table FK columns
      const sourceColType = findColumnType(tables, rel.source_table_name, rel.source_column_name) || 'INT';
      const targetColType = findColumnType(tables, rel.target_table_name, rel.target_column_name) || 'INT';

      // Find PK columns of source and target for the junction table references
      const sourcePKs = getPrimaryKeyColumns(tables, rel.source_table_name);
      const targetPKs = getPrimaryKeyColumns(tables, rel.target_table_name);
      const sourceRefCol = sourcePKs[0] || 'id';
      const targetRefCol = targetPKs[0] || 'id';
      const sourceRefType = findColumnType(tables, rel.source_table_name, sourceRefCol) || 'INT';
      const targetRefType = findColumnType(tables, rel.target_table_name, targetRefCol) || 'INT';

      // Find engine from any involved table
      const engine = tables.find((t) =>
        t.table_name === rel.source_table_name || t.table_name === rel.target_table_name,
      )?.engine || 'InnoDB';

      const sql = [
        `CREATE TABLE ${q(jName)} (`,
        `  ${q(rel.source_column_name)} ${sourceColType} NOT NULL,`,
        `  ${q(rel.target_column_name)} ${targetColType} NOT NULL,`,
        `  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,`,
        `  PRIMARY KEY (${q(rel.source_column_name)}, ${q(rel.target_column_name)}),`,
        `  CONSTRAINT ${q(`fk_${jName}_${rel.source_table_name}`)}`,
        `    FOREIGN KEY (${q(rel.source_column_name)})`,
        `    REFERENCES ${q(rel.source_table_name)}(${q(rel.source_column_name)}),`,
        `  CONSTRAINT ${q(`fk_${jName}_${rel.target_table_name}`)}`,
        `    FOREIGN KEY (${q(rel.target_column_name)})`,
        `    REFERENCES ${q(rel.target_table_name)}(${q(rel.target_column_name)})`,
        `) ENGINE=${engine};`,
      ].join('\n');

      junctionStatements.push({
        description: `中间表 ${jName}（${rel.source_table_name} ↔ ${rel.target_table_name}）`,
        sql,
      });
    }
  }

  if (fkStatements.length > 0) {
    result.push({ category: '外键约束 (FOREIGN KEY)', statements: fkStatements });
  }
  if (junctionStatements.length > 0) {
    result.push({ category: '中间表 (N:M)', statements: junctionStatements });
  }

  // --- 2. SELECT JOIN query templates ---
  const queryStatements: Array<{ description: string; sql: string }> = [];

  for (const rel of relations) {
    const joinType = rel.relation_type === '1:1' ? 'JOIN' : 'LEFT JOIN';
    const srcAlias = rel.source_table_name[0];
    const tgtAlias = rel.target_table_name[0];

    // Build column lists (use * for simplicity, but show a few key columns)
    const srcTable = tables.find((t) => t.table_name === rel.source_table_name);
    const tgtTable = tables.find((t) => t.table_name === rel.target_table_name);
    const srcCols = srcTable ? srcTable.columns.slice(0, 5).map((c) => `${srcAlias}.${q(c.column_name)}`).join(',\n  ') : `${srcAlias}.*`;
    const tgtCols = tgtTable ? tgtTable.columns.slice(0, 5).map((c) => `${tgtAlias}.${q(c.column_name)}`).join(',\n  ') : `${tgtAlias}.*`;

    let sql: string;
    if (rel.relation_type === 'N:M') {
      const jName = junctionName(rel.source_table_name, rel.target_table_name);
      const jAlias = 'j';
      sql = [
        `SELECT`,
        `  ${srcCols},`,
        `  ${tgtCols}`,
        `FROM ${q(rel.source_table_name)} ${srcAlias}`,
        `  ${joinType} ${q(jName)} ${jAlias}`,
        `    ON ${srcAlias}.${q(rel.source_column_name)} = ${jAlias}.${q(rel.source_column_name)}`,
        `  ${joinType} ${q(rel.target_table_name)} ${tgtAlias}`,
        `    ON ${jAlias}.${q(rel.target_column_name)} = ${tgtAlias}.${q(rel.target_column_name)};`,
      ].join('\n');
    } else {
      sql = [
        `SELECT`,
        `  ${srcCols},`,
        `  ${tgtCols}`,
        `FROM ${q(rel.source_table_name)} ${srcAlias}`,
        `  ${joinType} ${q(rel.target_table_name)} ${tgtAlias}`,
        `    ON ${srcAlias}.${q(rel.source_column_name)} = ${tgtAlias}.${q(rel.target_column_name)};`,
      ].join('\n');
    }

    const typeLabel = rel.relation_type === '1:1' ? '1:1' : rel.relation_type === '1:N' ? '1:N' : 'N:M';
    queryStatements.push({
      description: `${rel.source_table_name} ${typeLabel} ${rel.target_table_name}`,
      sql,
    });
  }

  if (queryStatements.length > 0) {
    result.push({ category: '查询模板 (SELECT JOIN)', statements: queryStatements });
  }

  return result;
}

/** Concatenate all generated SQL into a single string. */
export function generateAllSQL(relations: Relation[], tables: TableInfo[]): string {
  const groups = generateRelationSQL(relations, tables);
  return groups
    .map((g) => `-- ========== ${g.category} ==========\n\n` + g.statements.map((s) => `-- ${s.description}\n${s.sql}`).join('\n\n'))
    .join('\n\n');
}
