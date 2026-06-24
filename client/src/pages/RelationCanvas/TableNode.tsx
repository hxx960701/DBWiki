import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Card, Typography, Space } from 'antd';
import { TableOutlined } from '@ant-design/icons';

const { Text } = Typography;

export interface TableNodeData {
  label: string;
  columns: Array<{
    name: string;
    type: string;
    isPrimaryKey: boolean;
  }>;
  [key: string]: any;
}

const TableNode: React.FC<NodeProps> = ({ data, selected }) => {
  const tableData = data as TableNodeData;

  return (
    <Card
      size="small"
      style={{
        minWidth: 200,
        background: '#fff',
        border: selected ? '2px solid #1677ff' : '1px solid #d9d9d9',
        boxShadow: selected ? '0 0 0 2px rgba(22, 119, 255, 0.1)' : '0 2px 8px rgba(0,0,0,0.08)',
      }}
      styles={{ body: { padding: 0 } }}
    >
      <div
        style={{
          padding: '8px 12px',
          background: '#fafafa',
          borderBottom: '1px solid #f0f0f0',
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        <TableOutlined style={{ marginRight: 6 }} />
        {tableData.label}
      </div>
      <div style={{ padding: '8px 0' }}>
        {tableData.columns.map((col) => (
          <div
            key={col.name}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              position: 'relative',
            }}
          >
            <Handle
              type="target"
              position={Position.Left}
              id={`${col.name}-left`}
              style={{
                background: col.isPrimaryKey ? '#1677ff' : '#bfbfbf',
                width: 8,
                height: 8,
                left: 0,
              }}
            />
            <Space size={4}>
              {col.isPrimaryKey && (
                <Text type="danger" style={{ fontSize: 10 }}>
                  PK
                </Text>
              )}
              <Text code style={{ fontSize: 11 }}>
                {col.name}
              </Text>
              <Text type="secondary" style={{ fontSize: 10 }}>
                {col.type}
              </Text>
            </Space>
            <Handle
              type="source"
              position={Position.Right}
              id={`${col.name}-right`}
              style={{
                background: col.isPrimaryKey ? '#1677ff' : '#bfbfbf',
                width: 8,
                height: 8,
                right: 0,
              }}
            />
          </div>
        ))}
      </div>
    </Card>
  );
};

export default TableNode;
