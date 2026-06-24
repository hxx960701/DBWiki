import client from './client';

export interface Dimension {
  id: number;
  connection_id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface Relation {
  id: number;
  dimension_id: number;
  source_table_name: string;
  source_column_name: string;
  target_table_name: string;
  target_column_name: string;
  relation_type: '1:1' | '1:N' | 'N:M';
  created_at: string;
}

export interface TablePosition {
  id: number;
  dimension_id: number;
  table_name: string;
  position_x: number;
  position_y: number;
  updated_at: string;
}

export const relationsApi = {
  // Dimensions
  listDimensions: (connectionId: number) =>
    client.get(`/relations/connections/${connectionId}/dimensions`).then((r) => r.data),

  createDimension: (connectionId: number, data: { name: string; description?: string }) =>
    client.post(`/relations/connections/${connectionId}/dimensions`, data).then((r) => r.data),

  updateDimension: (id: number, data: { name?: string; description?: string }) =>
    client.put(`/relations/dimensions/${id}`, data).then((r) => r.data),

  deleteDimension: (id: number) =>
    client.delete(`/relations/dimensions/${id}`).then((r) => r.data),

  // Relations
  listRelations: (dimensionId: number) =>
    client.get(`/relations/dimensions/${dimensionId}/relations`).then((r) => r.data),

  createRelation: (
    dimensionId: number,
    data: {
      source_table_name: string;
      source_column_name: string;
      target_table_name: string;
      target_column_name: string;
      relation_type?: '1:1' | '1:N' | 'N:M';
    },
  ) => client.post(`/relations/dimensions/${dimensionId}/relations`, data).then((r) => r.data),

  updateRelation: (id: number, data: { relation_type?: string }) =>
    client.put(`/relations/relations/${id}`, data).then((r) => r.data),

  deleteRelation: (id: number) =>
    client.delete(`/relations/relations/${id}`).then((r) => r.data),

  // Positions
  getPositions: (dimensionId: number) =>
    client.get(`/relations/dimensions/${dimensionId}/positions`).then((r) => r.data),

  savePositions: (dimensionId: number, positions: Array<{ table_name: string; position_x: number; position_y: number }>) =>
    client.put(`/relations/dimensions/${dimensionId}/positions`, { positions }).then((r) => r.data),
};
