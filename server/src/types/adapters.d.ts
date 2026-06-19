declare module 'oracledb' {
  export interface PoolAttributes {
    user?: string;
    password?: string;
    connectString?: string;
    poolMin?: number;
    poolMax?: number;
    poolTimeout?: number;
    [key: string]: any;
  }

  export interface ExecuteOptions {
    outFormat?: number;
    [key: string]: any;
  }

  export interface Result<T = any> {
    rows: T[];
    rowsAffected?: number;
    metaData?: any[];
  }

  export interface Connection {
    execute(sql: string, binds?: Record<string, any>, options?: ExecuteOptions): Promise<Result>;
    close(): Promise<void>;
  }

  export interface Pool {
    getConnection(): Promise<Connection>;
    close(force?: number): Promise<void>;
  }

  export const OUT_FORMAT_OBJECT: number;

  export function createPool(attrs: PoolAttributes): Promise<Pool>;

  namespace oracledb {
    export { Pool, PoolAttributes, Connection, createPool, OUT_FORMAT_OBJECT };
  }

  export default oracledb;
}
