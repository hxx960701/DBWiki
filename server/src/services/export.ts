import knex from '../database/connection.js';
import { getDictionaryByConnection } from './dictionary.js';
import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Register Handlebars helpers
Handlebars.registerHelper('ifEqual', function (this: any, a: any, b: any, options: any) {
  return a === b ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('inc', function (value: number) {
  return value + 1;
});

let templateCompiled: Handlebars.TemplateDelegate | null = null;

function getTemplate(): Handlebars.TemplateDelegate {
  if (!templateCompiled) {
    const templatePath = path.join(__dirname, '../templates/dictionary.hbs');
    const source = fs.readFileSync(templatePath, 'utf-8');
    templateCompiled = Handlebars.compile(source);
  }
  return templateCompiled;
}

export async function exportToHTML(connectionId: number, versionParam?: string | number): Promise<string> {
  const dict = await getDictionaryByConnection(connectionId, versionParam);
  if (!dict.version) throw new Error('No dictionary data');

  const connection = await knex('database_connections').where({ id: connectionId }).first();
  const project = connection
    ? await knex('projects').where({ id: connection.project_id }).first()
    : null;
  const template = getTemplate();

  return template({
    projectName: project?.name || 'DBwiki',
    connectionName: connection?.name || '',
    dbType: connection?.db_type || '',
    version: dict.version.version_number,
    generatedAt: new Date().toISOString(),
    tables: dict.tables.map(t => ({
      ...t,
      columnCount: t.columns?.length || 0,
    })),
    procedures: dict.procedures || [],
    tableCount: dict.tables.length,
    columnCount: dict.tables.reduce((acc, t) => acc + (t.columns?.length || 0), 0),
    procedureCount: (dict.procedures || []).length,
  });
}

export async function exportToExcel(connectionId: number, versionParam?: string | number): Promise<Buffer> {
  const dict = await getDictionaryByConnection(connectionId, versionParam);
  if (!dict.version) throw new Error('No dictionary data');

  const connection = await knex('database_connections').where({ id: connectionId }).first();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DBwiki';
  workbook.created = new Date();

  // Summary sheet
  const summary = workbook.addWorksheet('Summary');
  summary.columns = [
    { header: 'Field', key: 'field', width: 25 },
    { header: 'Value', key: 'value', width: 50 },
  ];
  const summaryData = [
    { field: 'Connection', value: connection?.name || '' },
    { field: 'Database Type', value: connection?.db_type || '' },
    { field: 'Version', value: `v${dict.version.version_number}` },
    { field: 'Status', value: dict.version.status },
    { field: 'Tables', value: dict.tables.length },
    { field: 'Columns', value: dict.tables.reduce((a: number, t: any) => a + (t.columns?.length || 0), 0) },
    { field: 'Procedures', value: (dict.procedures || []).length },
    { field: 'Generated', value: new Date().toISOString() },
  ];
  summaryData.forEach(r => summary.addRow(r));
  summary.getRow(1).font = { bold: true };

  // Table list sheet
  const tableList = workbook.addWorksheet('Tables');
  tableList.columns = [
    { header: '#', key: 'num', width: 5 },
    { header: 'Table Name', key: 'name', width: 40 },
    { header: 'Comment', key: 'comment', width: 40 },
    { header: 'Custom Comment', key: 'custom', width: 40 },
    { header: 'Engine', key: 'engine', width: 15 },
    { header: 'Rows', key: 'rows', width: 12 },
    { header: 'Columns', key: 'cols', width: 10 },
  ];
  dict.tables.forEach((t: any, i: number) => {
    tableList.addRow({
      num: i + 1,
      name: t.table_name,
      comment: t.table_comment,
      custom: t.custom_comment,
      engine: t.engine,
      rows: t.row_count,
      cols: t.columns?.length || 0,
    });
  });
  tableList.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  tableList.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };

  // All columns sheet
  const allCols = workbook.addWorksheet('All Columns');
  allCols.columns = [
    { header: 'Table', key: 'table', width: 30 },
    { header: '#', key: 'pos', width: 5 },
    { header: 'Column', key: 'name', width: 30 },
    { header: 'Type', key: 'type', width: 25 },
    { header: 'Nullable', key: 'nullable', width: 10 },
    { header: 'Key', key: 'key', width: 8 },
    { header: 'Default', key: 'default', width: 20 },
    { header: 'DB Comment', key: 'dbComment', width: 40 },
    { header: 'Custom Comment', key: 'customComment', width: 40 },
    { header: 'Display Name', key: 'displayName', width: 30 },
  ];
  for (const table of dict.tables) {
    for (const col of (table.columns || [])) {
      allCols.addRow({
        table: table.table_name,
        pos: col.ordinal_position,
        name: col.column_name,
        type: col.column_type,
        nullable: col.is_nullable,
        key: col.column_key,
        default: col.column_default || '',
        dbComment: col.column_comment,
        customComment: col.custom_comment,
        displayName: col.display_name,
      });
    }
  }
  allCols.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  allCols.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };

  // Procedures sheet (only if any exist)
  const procedures = dict.procedures || [];
  if (procedures.length > 0) {
    const procSheet = workbook.addWorksheet('Procedures');
    procSheet.columns = [
      { header: '#', key: 'num', width: 5 },
      { header: 'Name', key: 'name', width: 40 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Return Type', key: 'returnType', width: 20 },
      { header: 'Parameters', key: 'params', width: 60 },
      { header: 'DB Comment', key: 'dbComment', width: 40 },
      { header: 'Custom Comment', key: 'customComment', width: 40 },
      { header: 'Last Modified', key: 'lastModified', width: 20 },
      { header: 'Definition', key: 'definition', width: 80 },
    ];
    procedures.forEach((p: any, i: number) => {
      const paramSummary = (p.parameters || [])
        .map((pr: any) => `${pr.mode || 'IN'} ${pr.name} ${pr.type}${pr.default ? ` DEFAULT ${pr.default}` : ''}`)
        .join('; ');
      procSheet.addRow({
        num: i + 1,
        name: p.procedure_name,
        type: p.procedure_type,
        returnType: p.return_type || '',
        params: paramSummary,
        dbComment: p.procedure_comment || '',
        customComment: p.custom_comment || '',
        lastModified: p.last_modified || '',
        definition: p.definition || '',
      });
    });
    procSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    procSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    procSheet.getColumn('definition').alignment = { wrapText: true, vertical: 'top' };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function exportToPDF(connectionId: number, versionParam?: string | number): Promise<Buffer> {
  // Generate HTML first, then convert to PDF via puppeteer
  const html = await exportToHTML(connectionId, versionParam);

  try {
    let puppeteer: any;
    try {
      // @ts-ignore - puppeteer is an optional dependency
      puppeteer = await import('puppeteer');
    } catch {
      throw new Error('PDF export requires puppeteer to be installed. Use HTML export as an alternative.');
    }
    const browser = await puppeteer.default.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '1cm', bottom: '1cm', left: '1cm', right: '1cm' },
    });
    await browser.close();
    return Buffer.from(pdf);
  } catch (err) {
    throw new Error('PDF export requires puppeteer to be installed. Use HTML export as an alternative.');
  }
}
