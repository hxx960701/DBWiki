import React, { useState } from 'react';
import { List, Input, Typography, Tag } from 'antd';
import { TableOutlined } from '@ant-design/icons';

const { Search } = Input;
const { Text } = Typography;

interface TableListProps {
  tables: Array<{
    table_name: string;
    columns?: Array<{ column_name: string }>;
  }>;
  onDragStart: (tableName: string) => void;
}

const TableList: React.FC<TableListProps> = ({ tables, onDragStart }) => {
  const [searchText, setSearchText] = useState('');

  const filteredTables = tables.filter((t) =>
    t.table_name.toLowerCase().includes(searchText.toLowerCase()),
  );

  return (
    <div style={{ padding: '12px 16px' }}>
      <Text strong style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>
        数据表
      </Text>
      <Search
        placeholder="搜索表名..."
        allowClear
        size="small"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        style={{ marginBottom: 12 }}
      />
      <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 400px)' }}>
        <List
          size="small"
          dataSource={filteredTables}
          renderItem={(table) => (
            <List.Item
              draggable
              onDragStart={() => onDragStart(table.table_name)}
              style={{
                cursor: 'grab',
                padding: '8px 12px',
                border: '1px solid #f0f0f0',
                borderRadius: 4,
                marginBottom: 4,
                background: '#fff',
              }}
            >
              <div style={{ width: '100%' }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  <TableOutlined style={{ marginRight: 6, color: '#1677ff' }} />
                  {table.table_name}
                </div>
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                  {table.columns?.length || 0} 个字段
                </div>
              </div>
            </List.Item>
          )}
        />
      </div>
    </div>
  );
};

export default TableList;
