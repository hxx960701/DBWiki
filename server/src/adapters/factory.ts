import type { DatabaseAdapter, ConnectionConfig } from './types.js';
import { MySQLAdapter } from './mysql.js';
import { PostgreSQLAdapter } from './postgresql.js';
import { MSSQLAdapter } from './mssql.js';
import { OracleAdapter } from './oracle.js';
import { StarRocksAdapter } from './starrocks.js';
import { ClickHouseAdapter } from './clickhouse.js';
import { InfluxDBAdapter } from './influxdb.js';

export function createAdapter(dbType: string, config: ConnectionConfig): DatabaseAdapter {
  switch (dbType) {
    case 'mysql': return new MySQLAdapter(config);
    case 'postgresql': return new PostgreSQLAdapter(config);
    case 'mssql': return new MSSQLAdapter(config);
    case 'oracle': return new OracleAdapter(config);
    case 'starrocks': return new StarRocksAdapter(config);
    case 'clickhouse': return new ClickHouseAdapter(config);
    case 'influxdb': return new InfluxDBAdapter(config);
    default: throw new Error(`Unsupported database type: ${dbType}`);
  }
}
