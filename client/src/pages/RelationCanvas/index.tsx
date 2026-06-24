import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Layout, Card, Button, Space, Typography, message, Spin, Empty, Modal, Select, Tabs,
} from 'antd';
import {
  ArrowLeftOutlined, CompressOutlined, ZoomInOutlined, ZoomOutOutlined, CodeOutlined,
} from '@ant-design/icons';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { relationsApi, type Dimension, type Relation } from '../../api/relations';
import { dictionaryApi } from '../../api/dictionary';
import { generateRelationSQL, generateAllSQL } from '../../utils/sqlGenerator';
import DimensionSelector from './DimensionSelector';
import TableList from './TableList';
import TableNode from './TableNode';
import RelationEdge from './RelationEdge';

const { Sider, Content } = Layout;
const { Text, Title } = Typography;

const nodeTypes = { tableNode: TableNode };
const edgeTypes = { relationEdge: RelationEdge };

const RelationCanvasInner: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const connectionId = parseInt(id || '0');

  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [selectedDimension, setSelectedDimension] = useState<Dimension | null>(null);
  const [tables, setTables] = useState<any[]>([]);
  const [connectionName, setConnectionName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(true);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [positionsMap, setPositionsMap] = useState<Map<string, { x: number; y: number }>>(new Map());

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const savePositionsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Load dictionary data
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await dictionaryApi.getDictionary(connectionId, 'latest');
        setTables(data.tables || []);
        setConnectionName(data.connection_name || '');
        setProjectName(data.project_name || '');
      } catch (err: any) {
        message.error('加载字典数据失败');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [connectionId]);

  // Load dimensions
  const loadDimensions = useCallback(async () => {
    try {
      const dims = await relationsApi.listDimensions(connectionId);
      setDimensions(dims);
    } catch (err: any) {
      message.error('加载维度失败');
    }
  }, [connectionId]);

  useEffect(() => {
    loadDimensions();
  }, [loadDimensions]);

  // Load relations and positions when dimension changes
  useEffect(() => {
    if (!selectedDimension) {
      setRelations([]);
      setPositionsMap(new Map());
      setNodes([]);
      setEdges([]);
      return;
    }

    const load = async () => {
      try {
        const [rels, positions] = await Promise.all([
          relationsApi.listRelations(selectedDimension.id),
          relationsApi.getPositions(selectedDimension.id),
        ]);
        setRelations(rels);

        const posMap = new Map<string, { x: number; y: number }>();
        for (const p of positions) {
          posMap.set(p.table_name, { x: p.position_x, y: p.position_y });
        }
        setPositionsMap(posMap);
      } catch (err: any) {
        message.error('加载关联数据失败');
      }
    };
    load();
  }, [selectedDimension]);

  // Build nodes and edges from data
  useEffect(() => {
    if (!selectedDimension) return;

    // Determine which tables are on the canvas (have positions or are part of a relation)
    const tableNamesOnCanvas = new Set<string>();
    for (const rel of relations) {
      tableNamesOnCanvas.add(rel.source_table_name);
      tableNamesOnCanvas.add(rel.target_table_name);
    }
    for (const [name] of positionsMap) {
      tableNamesOnCanvas.add(name);
    }

    // Build nodes
    const newNodes: Node[] = [];
    let autoX = 50;
    let autoY = 50;

    for (const tableName of tableNamesOnCanvas) {
      const table = tables.find((t) => t.table_name === tableName);
      if (!table) continue;

      const pos = positionsMap.get(tableName);
      const x = pos?.x ?? autoX;
      const y = pos?.y ?? autoY;
      autoX += 300;
      if (autoX > 2000) {
        autoX = 50;
        autoY += 400;
      }

      newNodes.push({
        id: tableName,
        type: 'tableNode',
        position: { x, y },
        data: {
          label: tableName,
          columns: (table.columns || []).map((c: any) => ({
            name: c.column_name,
            type: c.column_type,
            isPrimaryKey: c.column_key === 'PRI',
          })),
        },
      });
    }

    // Build edges
    const newEdges: Edge[] = relations.map((rel) => ({
      id: `e-${rel.id}`,
      source: rel.source_table_name,
      target: rel.target_table_name,
      sourceHandle: `${rel.source_column_name}-right`,
      targetHandle: `${rel.target_column_name}-left`,
      type: 'relationEdge',
      data: {
        relationType: rel.relation_type,
        relationId: rel.id,
      },
      label: rel.relation_type,
    }));

    setNodes(newNodes);
    setEdges(newEdges);
  }, [selectedDimension, relations, positionsMap, tables]);

  // Handle drag from table list
  const handleDragStart = useCallback((tableName: string) => {
    // Store the table name for drop
    (window as any).__dragTableName = tableName;
  }, []);

  // Handle drop on canvas
  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const tableName = (window as any).__dragTableName;
      if (!tableName || !selectedDimension) return;

      // Check if node already exists
      if (nodes.find((n) => n.id === tableName)) {
        message.warning('该表已在画布上');
        return;
      }

      const table = tables.find((t) => t.table_name === tableName);
      if (!table) return;

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!reactFlowBounds) return;

      const position = {
        x: event.clientX - reactFlowBounds.left - 100,
        y: event.clientY - reactFlowBounds.top - 50,
      };

      const newNode: Node = {
        id: tableName,
        type: 'tableNode',
        position,
        data: {
          label: tableName,
          columns: (table.columns || []).map((c: any) => ({
            name: c.column_name,
            type: c.column_type,
            isPrimaryKey: c.column_key === 'PRI',
          })),
        },
      };

      setNodes((nds) => [...nds, newNode]);
      debouncedSavePositions([...nodes, newNode]);
    },
    [nodes, selectedDimension, tables],
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Handle new connection (edge)
  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!selectedDimension) return;

      // Extract column names from handle IDs
      const sourceColumn = connection.sourceHandle?.replace('-right', '') || '';
      const targetColumn = connection.targetHandle?.replace('-left', '') || '';

      if (!sourceColumn || !targetColumn) {
        message.error('无法确定关联字段');
        return;
      }

      try {
        const rel = await relationsApi.createRelation(selectedDimension.id, {
          source_table_name: connection.source!,
          source_column_name: sourceColumn,
          target_table_name: connection.target!,
          target_column_name: targetColumn,
        });
        setRelations((prev) => [...prev, rel]);
        message.success('关联已创建');
      } catch (err: any) {
        message.error('创建关联失败: ' + (err.response?.data?.error || err.message));
      }
    },
    [selectedDimension],
  );

  // Save positions with debounce
  const debouncedSavePositions = useCallback(
    (currentNodes: Node[]) => {
      if (!selectedDimension) return;
      if (savePositionsTimer.current) {
        clearTimeout(savePositionsTimer.current);
      }
      savePositionsTimer.current = setTimeout(async () => {
        const positions = currentNodes.map((n) => ({
          table_name: n.id,
          position_x: Math.round(n.position.x),
          position_y: Math.round(n.position.y),
        }));
        try {
          await relationsApi.savePositions(selectedDimension.id, positions);
        } catch (err: any) {
          message.error('保存布局失败');
        }
      }, 500);
    },
    [selectedDimension],
  );

  // Handle node drag stop
  const onNodeDragStop = useCallback(
    (_: any, node: any) => {
      debouncedSavePositions(nodes);
    },
    [nodes, debouncedSavePositions],
  );

  // Handle edge click (edit relation type)
  const [editRelationModalOpen, setEditRelationModalOpen] = useState(false);
  const [editingRelation, setEditingRelation] = useState<Relation | null>(null);
  const [newRelationType, setNewRelationType] = useState<string>('1:N');

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    const relationId = edge.data?.relationId;
    const rel = relations.find((r) => r.id === relationId);
    if (rel) {
      setEditingRelation(rel);
      setNewRelationType(rel.relation_type);
      setEditRelationModalOpen(true);
    }
  }, [relations]);

  const handleUpdateRelationType = async () => {
    if (!editingRelation) return;
    try {
      await relationsApi.updateRelation(editingRelation.id, {
        relation_type: newRelationType as any,
      });
      setRelations((prev) =>
        prev.map((r) => (r.id === editingRelation.id ? { ...r, relation_type: newRelationType as any } : r)),
      );
      message.success('关联类型已更新');
      setEditRelationModalOpen(false);
    } catch (err: any) {
      message.error('更新失败: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDeleteRelation = async () => {
    if (!editingRelation) return;
    try {
      await relationsApi.deleteRelation(editingRelation.id);
      setRelations((prev) => prev.filter((r) => r.id !== editingRelation.id));
      message.success('关联已删除');
      setEditRelationModalOpen(false);
    } catch (err: any) {
      message.error('删除失败: ' + (err.response?.data?.error || err.message));
    }
  };

  // SQL generation modal
  const [sqlModalOpen, setSqlModalOpen] = useState(false);
  const [generatedSQL, setGeneratedSQL] = useState('');

  const handleGenerateSQL = () => {
    if (relations.length === 0) {
      message.warning('当前维度没有关联关系');
      return;
    }
    const sql = generateAllSQL(relations, tables);
    setGeneratedSQL(sql);
    setSqlModalOpen(true);
  };

  const handleCopySQL = () => {
    navigator.clipboard.writeText(generatedSQL);
    message.success('SQL已复制到剪贴板');
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }} styles={{ body: { padding: 16 } }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
              返回
            </Button>
            <Title level={5} style={{ margin: 0 }}>
              表关联管理
            </Title>
            <Text type="secondary">
              {projectName}{projectName && connectionName ? ' / ' : ''}{connectionName}
            </Text>
          </Space>
          <Space>
            <Button size="small" icon={<CodeOutlined />} onClick={handleGenerateSQL} type="primary">
              生成SQL
            </Button>
            <Button size="small" icon={<ZoomInOutlined />} onClick={() => {
              // Zoom in handled by ReactFlow controls
            }}>
              放大
            </Button>
            <Button size="small" icon={<ZoomOutOutlined />}>
              缩小
            </Button>
            <Button size="small" icon={<CompressOutlined />}>
              适应画布
            </Button>
          </Space>
        </div>
      </Card>

      <Layout style={{ height: 'calc(100vh - 200px)', background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
        <Sider width={280} style={{ background: '#fff', borderRight: '1px solid #f0f0f0', overflow: 'auto' }}>
          <DimensionSelector
            connectionId={connectionId}
            selectedDimension={selectedDimension}
            onDimensionChange={setSelectedDimension}
            dimensions={dimensions}
            onDimensionsUpdate={loadDimensions}
            canEdit={true}
          />
          {selectedDimension && (
            <TableList tables={tables} onDragStart={handleDragStart} />
          )}
          {!selectedDimension && (
            <div style={{ padding: 16 }}>
              <Empty description="请先选择或创建一个维度" />
            </div>
          )}
        </Sider>
        <Content style={{ position: 'relative' }} ref={reactFlowWrapper}>
          {selectedDimension ? (
            <div style={{ width: '100%', height: '100%' }} onDrop={handleDrop} onDragOver={handleDragOver}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDragStop={onNodeDragStop}
                onEdgeClick={onEdgeClick}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                snapToGrid
                snapGrid={[15, 15]}
              >
                <Background />
                <Controls />
                <MiniMap />
              </ReactFlow>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Empty description="请先选择或创建一个维度" />
            </div>
          )}
        </Content>
      </Layout>

      {/* Edit relation type modal */}
      <Modal
        title="编辑关联"
        open={editRelationModalOpen}
        onCancel={() => setEditRelationModalOpen(false)}
        footer={[
          <Button key="delete" danger onClick={handleDeleteRelation}>
            删除关联
          </Button>,
          <Button key="cancel" onClick={() => setEditRelationModalOpen(false)}>
            取消
          </Button>,
          <Button key="save" type="primary" onClick={handleUpdateRelationType}>
            保存
          </Button>,
        ]}
      >
        {editingRelation && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Text strong>{editingRelation.source_table_name}</Text>
              <Text code style={{ margin: '0 8px' }}>{editingRelation.source_column_name}</Text>
              <Text>→</Text>
              <Text strong style={{ marginLeft: 8 }}>{editingRelation.target_table_name}</Text>
              <Text code style={{ margin: '0 8px' }}>{editingRelation.target_column_name}</Text>
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>关联类型</Text>
              <Select
                value={newRelationType}
                onChange={setNewRelationType}
                style={{ width: '100%' }}
                options={[
                  { value: '1:1', label: '1:1 (一对一)' },
                  { value: '1:N', label: '1:N (一对多)' },
                  { value: 'N:M', label: 'N:M (多对多)' },
                ]}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* SQL generation modal */}
      <Modal
        title="生成SQL"
        open={sqlModalOpen}
        onCancel={() => setSqlModalOpen(false)}
        width={900}
        footer={[
          <Button key="copy" type="primary" onClick={handleCopySQL}>
            复制全部
          </Button>,
          <Button key="close" onClick={() => setSqlModalOpen(false)}>
            关闭
          </Button>,
        ]}
      >
        {generatedSQL && (
          <Tabs
            defaultActiveKey="all"
            items={[
              {
                key: 'all',
                label: '完整SQL',
                children: (
                  <pre
                    style={{
                      background: '#f5f5f5',
                      padding: 16,
                      borderRadius: 4,
                      overflow: 'auto',
                      maxHeight: 500,
                      fontSize: 13,
                      fontFamily: 'monospace',
                      lineHeight: 1.6,
                    }}
                  >
                    {generatedSQL}
                  </pre>
                ),
              },
              ...generateRelationSQL(relations, tables).map((group, idx) => ({
                key: `group-${idx}`,
                label: group.category,
                children: (
                  <div style={{ maxHeight: 500, overflow: 'auto' }}>
                    {group.statements.map((stmt, sIdx) => (
                      <div key={sIdx} style={{ marginBottom: 16 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {stmt.description}
                        </Text>
                        <pre
                          style={{
                            background: '#f5f5f5',
                            padding: 12,
                            borderRadius: 4,
                            overflow: 'auto',
                            fontSize: 13,
                            fontFamily: 'monospace',
                            lineHeight: 1.6,
                            marginTop: 4,
                          }}
                        >
                          {stmt.sql}
                        </pre>
                      </div>
                    ))}
                  </div>
                ),
              })),
            ]}
          />
        )}
      </Modal>
    </div>
  );
};

const RelationCanvas: React.FC = () => {
  return (
    <ReactFlowProvider>
      <RelationCanvasInner />
    </ReactFlowProvider>
  );
};

export default RelationCanvas;
