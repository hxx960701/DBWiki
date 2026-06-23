export interface User {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  permissions?: string[];
  roles?: Array<{ role_id: number; role_name: string }>;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  created_by: number;
  creator_name?: string;
  member_count?: number;
  connection_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  id: number;
  project_id: number;
  user_id: number;
  role: string;
  role_id?: number;
  role_name?: string;
  username?: string;
  email?: string;
}

export interface Role {
  id: number;
  name: string;
  description?: string;
  is_system: boolean;
  permission_codes?: string[];
}

export interface Permission {
  code: string;
  name: string;
  description?: string;
  scope: 'global' | 'project';
}

export interface ProjectRoleBinding {
  id: number;
  project_id: number;
  role_id: number;
  role_name?: string;
  role_description?: string;
  created_at: string;
}

export interface DatabaseConnection {
  id: number;
  project_id: number;
  name: string;
  db_type: string;
  host: string;
  port: number;
  database_name: string;
  username?: string;
  extra_config?: Record<string, any>;
  created_at: string;
  updated_at: string;
  latest_version?: {
    version_number: number;
    status: string;
    created_at: string;
  };
}

export interface DictionaryVersion {
  id: number;
  connection_id: number;
  version_number: number;
  status: 'draft' | 'published';
  created_at: string;
  published_at: string | null;
  notes: string;
  table_count?: number;
  column_count?: number;
}

export interface DictionaryTable {
  id: number;
  version_id: number;
  table_name: string;
  table_comment: string;
  custom_comment: string;
  engine: string;
  row_count: number;
  columns?: DictionaryColumn[];
  indexes?: DictionaryIndex[];
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
  tags: string[];
  ordinal_position: number;
}

export interface DictionaryIndex {
  id: number;
  table_id: number;
  index_name: string;
  index_type: string;
  columns: string[];
  is_unique: number;
}

export interface DictionaryProcedureParam {
  name: string;
  type: string;
  mode: string;
  default: string | null;
}

export interface DictionaryProcedure {
  id: number;
  version_id: number;
  procedure_name: string;
  procedure_type: string;
  return_type: string;
  parameters: DictionaryProcedureParam[];
  definition: string;
  procedure_comment: string;
  custom_comment: string;
  last_modified: string;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  token: string;
  user: User;
  mustChangePassword?: boolean;
}
