// Database models
export interface User {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'editor' | 'viewer';
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  id: number;
  project_id: number;
  user_id: number;
  role: 'admin' | 'editor' | 'viewer';
  created_at: string;
}

export interface DatabaseConnection {
  id: number;
  project_id: number;
  name: string;
  db_type: 'mysql' | 'postgresql' | 'mssql' | 'oracle' | 'starrocks' | 'clickhouse' | 'influxdb';
  host: string;
  port: number;
  database_name: string;
  username: string;
  encrypted_password: string;
  extra_config: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface DictionaryVersion {
  id: number;
  connection_id: number;
  version_number: number;
  status: 'draft' | 'published';
  snapshot_data: string;
  created_by: number;
  created_at: string;
  published_at: string | null;
  notes: string;
}

export interface DictionaryTable {
  id: number;
  version_id: number;
  table_name: string;
  table_comment: string;
  custom_comment: string;
  engine: string;
  row_count: number;
  created_at: string;
  updated_at: string;
}

export interface DictionaryColumn {
  id: number;
  table_id: number;
  column_name: string;
  column_type: string;
  is_nullable: string;
  column_key: string;
  column_default: string | null;
  extra: string;
  column_comment: string;
  custom_comment: string;
  display_name: string;
  tags: string;
  ordinal_position: number;
}

export interface DictionaryIndex {
  id: number;
  table_id: number;
  index_name: string;
  index_type: string;
  columns: string;
  is_unique: number;
}

export interface DictionaryProcedure {
  id: number;
  version_id: number;
  procedure_name: string;
  procedure_type: string;   // 'PROCEDURE' | 'FUNCTION'
  return_type: string;
  parameters: string;        // JSON-encoded array
  definition: string;
  procedure_comment: string;
  custom_comment: string;
  last_modified: string;
  created_at: string;
  updated_at: string;
}

// API types
export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
  /**
   * Global permission codes granted via user_roles → role_permissions.
   * Project-scoped permissions in this set apply to ALL projects (e.g. system-admin).
   * Project-scoped permissions held only via per-project bindings are resolved
   * at request time and NOT included here.
   */
  permissions?: string[];
}

export interface AuthResponse {
  token: string;
  user: Omit<User, 'password_hash'>;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
