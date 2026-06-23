import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Layout, Input, List, Tag, Table, Tabs, Select, Button, Space, Typography,
  Badge, Spin, Empty, Card, message, Drawer, Alert, Form, Input as AntInput,
  Modal, Result, Tooltip,
} from 'antd';
import {
  SyncOutlined, ArrowLeftOutlined, SaveOutlined, CloudUploadOutlined,
  TableOutlined, HistoryOutlined, FunctionOutlined,
} from '@ant-design/icons';
import { useDictionaryStore } from '../../stores/dictionaryStore';
import { dictionaryApi } from '../../api/dictionary';
import { connectionsApi } from '../../api/connections';
import { useAuthStore } from '../../stores/authStore';
import type { DictionaryColumn, DictionaryProcedure } from '../../types';

const { Sider, Content } = Layout;
const { Text, Title } = Typography;
const { Search } = Input;
const { TextArea } = AntInput;

const keyColors: Record<string, string> = {
  PRI: 'blue',
  UNI: 'orange',
  MUL: 'green',
};

const DictionaryBrowser: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const connectionId = parseInt(id || '0');
  const { hasPermission } = useAuthStore();

  const {
    versions, tables, procedures, currentVersion,
    connectionName, projectName,
    selectedTableId, selectedProcedureId, syncing,
    pendingTableChanges, pendingColumnChanges, pendingProcedureChanges,
    syncDiff, syncDiffLoading,
    fetchVersions, fetchDictionary, previewSync, applySyncPreview, clearSyncDiff,
    setSyncOverride, selectTable, selectProcedure,
    setTablePending, setColumnPending, setProcedurePending,
    saveDictionary, publishCurrent,
  } = useDictionaryStore();

  const [searchText, setSearchText] = useState('');
  const [procSearchText, setProcSearchText] = useState('');
  const [procTypeFilter, setProcTypeFilter] = useState<string>('all');
  const [selectedVersion, setSelectedVersion] = useState<string>('latest');
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishForm] = Form.useForm();
  const [exporting, setExporting] = useState(false);
  const [topTab, setTopTab] = useState<string>('tables');
  const [detailTabKey, setDetailTabKey] = useState<string>('columns');
  const [sampleData, setSampleData] = useState<{ columns: string[]; rows: any[][] } | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [draftDrawerOpen, setDraftDrawerOpen] = useState(false);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);

  const canEdit = hasPermission('dictionary:edit');
  const canSave = hasPermission('dictionary:save');
  const canPublish = hasPermission('dictionary:publish');
  const canSync = hasPermission('connection:sync');

  const pendingCount =
    Object.keys(pendingTableChanges).length
    + Object.keys(pendingColumnChanges).length
    + Object.keys(pendingProcedureChanges).length;

  // Only show published versions in the dropdown — drafts are internal.
  const publishedVersions = versions.filter((v) => v.status === 'published');

  // Warn on exit if there are unsaved edits or a draft version
  const hasDraftWork = pendingCount > 0 || currentVersion?.status === 'draft';

  useEffect(() => {
    fetchVersions(connectionId);
    fetchDictionary(connectionId, 'latest');
  }, [connectionId]);

  // beforeunload — warn when closing tab with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasDraftWork) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasDraftWork]);

  // Guarded navigate — confirm before leaving with unsaved changes
  const navigatingAway = useRef(false);
  useEffect(() => {
    navigatingAway.current = false;
  }, [hasDraftWork]);

  // popstate — intercept browser back/forward with unsaved changes
  useEffect(() => {
    if (!hasDraftWork) return;
    const handler = () => {
      if (navigatingAway.current) return;
      // Push state back to cancel the navigation
      window.history.pushState(null, '', window.location.href);
      Modal.confirm({
        title: '未保存的修改',
        content: `有草稿未发布，退出后将丢失。系统只保留已发布的字典版本。确定离开吗？`,
        okText: '离开',
        cancelText: '留下',
        onOk: () => {
          navigatingAway.current = true;
          window.history.back();
        },
        onCancel: () => { /* already pushed state back */ },
      });
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [hasDraftWork]);

  const guardedNavigate = (to: number | string) => {
    if (hasDraftWork) {
      Modal.confirm({
        title: '未保存的修改',
        content: `有草稿未发布，退出后将丢失。系统只保留已发布的字典版本。确定离开吗？`,
        okText: '离开',
        cancelText: '留下',
        onOk: () => navigate(to as any),
      });
    } else {
      navigate(to as any);
    }
  };

  const filteredTables = tables
    .map((t) => {
      if (!searchText.trim()) {
        return { table: t, matchedColumnNames: [] as string[] };
      }
      const q = searchText.toLowerCase().trim();
      // Search table-level fields
      const tableMatch =
        t.table_name.toLowerCase().includes(q)
        || (t.table_comment || '').toLowerCase().includes(q)
        || (t.custom_comment || '').toLowerCase().includes(q);
      // Search column-level fields
      const matchedColumnNames: string[] = [];
      for (const col of t.columns || []) {
        const colMatch =
          col.column_name.toLowerCase().includes(q)
          || (col.column_comment || '').toLowerCase().includes(q)
          || (col.custom_comment || '').toLowerCase().includes(q)
          || (col.display_name || '').toLowerCase().includes(q);
        if (colMatch) matchedColumnNames.push(col.column_name);
      }
      const match = tableMatch || matchedColumnNames.length > 0;
      if (!match) return null;
      return { table: t, matchedColumnNames };
    })
    .filter((item): item is { table: typeof tables[0]; matchedColumnNames: string[] } => item !== null);
  const selectedTable = tables.find((t) => t.id === selectedTableId);

  const filteredProcedures = procedures.filter((p) => {
    const nameMatch = p.procedure_name.toLowerCase().includes(procSearchText.toLowerCase());
    const typeMatch = procTypeFilter === 'all' || p.procedure_type === procTypeFilter;
    return nameMatch && typeMatch;
  });
  const selectedProcedure = procedures.find((p) => p.id === selectedProcedureId);

  const effectiveColumnValue = (col: DictionaryColumn, field: 'custom_comment' | 'display_name' | 'tags') => {
    const pending = pendingColumnChanges[col.id];
    if (pending && field in pending) {
      return (pending as any)[field];
    }
    return (col as any)[field];
  };

  const effectiveProcedureCustom = (proc: DictionaryProcedure) => {
    const pending = pendingProcedureChanges[proc.id];
    if (pending && 'custom_comment' in pending) return pending.custom_comment ?? '';
    return proc.custom_comment;
  };

  const handleVersionChange = (val: string) => {
    setSelectedVersion(val);
    fetchDictionary(connectionId, val);
  };

  const handleSync = async () => {
    await previewSync(connectionId);
    setSyncDrawerOpen(true);
  };

  const handleApplySync = async () => {
    try {
      const v = await applySyncPreview(connectionId);
      message.success(`已应用为新草稿 v${v.version_number}`);
      setSyncDrawerOpen(false);
    } catch (err: any) {
      message.error('应用失败: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleSave = async () => {
    try {
      await saveDictionary(connectionId);
      message.success('已保存');
    } catch (err: any) {
      message.error('保存失败: ' + (err.response?.data?.error || err.message));
    }
  };

  const handlePublish = async () => {
    try {
      const { notes } = await publishForm.validateFields();
      const v = currentVersion;
      if (!v) throw new Error('No version to publish');

      const result = await dictionaryApi.publishVersionWithForce(v.id, notes, false);
      if (result.stale) {
        // Draft is based on outdated structure — ask user to confirm
        Modal.confirm({
          title: '草稿可能不是最新结构',
          content: result.message,
          okText: '确认发布',
          cancelText: '取消',
          onOk: async () => {
            try {
              await dictionaryApi.publishVersionWithForce(v.id, notes, true);
              message.success('已发布');
              setPublishOpen(false);
              publishForm.resetFields();
              fetchDictionary(connectionId, 'latest');
              fetchVersions(connectionId);
              loadDrafts();
            } catch (e: any) {
              message.error(e.response?.data?.error || '发布失败');
            }
          },
        });
      } else {
        message.success('已发布');
        setPublishOpen(false);
        publishForm.resetFields();
        fetchDictionary(connectionId, 'latest');
        fetchVersions(connectionId);
        loadDrafts();
      }
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error('发布失败: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleExport = async (format: string) => {
    setExporting(true);
    try {
      const filename = await dictionaryApi.exportDictionary(connectionId, format, selectedVersion);
      message.success(`已下载 ${filename}`);
    } catch (err: any) {
      message.error('导出失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setExporting(false);
    }
  };

  // ---- Draft box ----
  const loadDrafts = async () => {
    setDraftsLoading(true);
    try {
      const data = await dictionaryApi.getDrafts(connectionId);
      setDrafts(Array.isArray(data) ? data : []);
    } catch {
      message.error('加载草稿失败');
    }
    setDraftsLoading(false);
  };

  const openDraftBox = () => {
    loadDrafts();
    setDraftDrawerOpen(true);
  };

  const handleViewDraft = (draft: any) => {
    setDraftDrawerOpen(false);
    setSelectedVersion(String(draft.version_number));
    fetchDictionary(connectionId, draft.version_number);
  };

  const handleDeleteDraft = (draft: any) => {
    Modal.confirm({
      title: '删除草稿',
      content: `确定删除 v${draft.version_number}（${draft.connection_name}）的草稿吗？`,
      okText: '删除',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await dictionaryApi.deleteDraft(draft.id);
          message.success('草稿已删除');
          loadDrafts();
        } catch (err: any) {
          message.error(err.response?.data?.error || '删除失败');
        }
      },
    });
  };

  const handlePublishDraft = async (draft: any) => {
    try {
      const result = await dictionaryApi.publishVersionWithForce(draft.id, '', false);
      if (result.stale) {
        Modal.confirm({
          title: '草稿可能不是最新结构',
          content: result.message,
          okText: '确认发布',
          cancelText: '取消',
          onOk: async () => {
            try {
              await dictionaryApi.publishVersionWithForce(draft.id, '', true);
              message.success('已发布');
              loadDrafts();
              if (connectionId === draft.connection_id) {
                fetchDictionary(connectionId, 'latest');
                fetchVersions(connectionId);
              }
            } catch (e: any) {
              message.error(e.response?.data?.error || '发布失败');
            }
          },
        });
      } else {
        message.success('已发布');
        loadDrafts();
        if (connectionId === draft.connection_id) {
          fetchDictionary(connectionId, 'latest');
          fetchVersions(connectionId);
        }
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || '发布失败');
    }
  };

  const fetchSampleData = useCallback(async (tableId: number) => {
    setSampleLoading(true);
    setSampleError(null);
    setSampleData(null);
    try {
      const data = await connectionsApi.dataPreview(connectionId, tableId, 10);
      setSampleData(data);
    } catch (err: any) {
      setSampleError(err.response?.data?.error || err.message || '加载数据预览失败');
    } finally {
      setSampleLoading(false);
    }
  }, [connectionId]);

  // Clear sample data when table selection changes
  useEffect(() => {
    setSampleData(null);
    setSampleError(null);
  }, [selectedTableId]);

  // Fetch sample data when switching to the data-preview tab
  useEffect(() => {
    if (detailTabKey === 'data-preview' && selectedTableId && !sampleData && !sampleLoading) {
      fetchSampleData(selectedTableId);
    }
  }, [detailTabKey, selectedTableId, sampleData, sampleLoading, fetchSampleData]);

  // Editable cell writes to pending state only.
  const EditableCell: React.FC<{
    value: string;
    onSave: (val: string) => void;
    placeholder?: string;
  }> = ({ value, onSave, placeholder }) => {
    const [editing, setEditing] = useState(false);
    const [inputVal, setInputVal] = useState(value);

    useEffect(() => { setInputVal(value); }, [value]);

    if (!canEdit) {
      return <span>{value || <Text type="secondary">-</Text>}</span>;
    }
    if (editing) {
      return (
        <Input
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={() => { setEditing(false); if (inputVal !== value) onSave(inputVal); }}
          onPressEnter={() => { setEditing(false); if (inputVal !== value) onSave(inputVal); }}
          autoFocus
          size="small"
        />
      );
    }
    return (
      <span
        onClick={() => setEditing(true)}
        style={{ cursor: 'pointer', color: value ? undefined : '#bbb', minHeight: 22, display: 'inline-block' }}
      >
        {value || placeholder || '点击编辑'}
      </span>
    );
  };

  const columnTableColumns = [
    { title: '#', dataIndex: 'ordinal_position', key: 'pos', width: 50 },
    {
      title: '字段名', key: 'name', width: 200,
      render: (_: any, record: DictionaryColumn) => (
        <div>
          <Text strong code>{record.column_name}</Text>
          {effectiveColumnValue(record, 'display_name') && (
            <div><Text type="secondary" style={{ fontSize: 12 }}>{effectiveColumnValue(record, 'display_name')}</Text></div>
          )}
        </div>
      ),
    },
    {
      title: '类型', dataIndex: 'column_type', key: 'type', width: 160,
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: '键', dataIndex: 'column_key', key: 'key', width: 60,
      render: (v: string) => v ? <Tag color={keyColors[v] || 'default'}>{v}</Tag> : null,
    },
    {
      title: '可空', dataIndex: 'is_nullable', key: 'nullable', width: 60,
      render: (v: string) => <Tag color={v === 'YES' ? 'default' : 'red'}>{v === 'YES' ? '是' : '否'}</Tag>,
    },
    { title: '默认值', dataIndex: 'column_default', key: 'default', width: 120, render: (v: string | null) => v || '-' },
    {
      title: '数据库注释', dataIndex: 'column_comment', key: 'dbComment', width: 200,
      render: (v: string) => <Text type="secondary">{v || '-'}</Text>,
    },
    {
      title: '自定义注释', key: 'customComment', width: 200,
      render: (_: any, record: DictionaryColumn) => (
        <EditableCell
          value={effectiveColumnValue(record, 'custom_comment') || ''}
          onSave={(val) => setColumnPending(record.id, { custom_comment: val })}
          placeholder="添加注释"
        />
      ),
    },
    {
      title: '显示名', key: 'displayName', width: 150,
      render: (_: any, record: DictionaryColumn) => (
        <EditableCell
          value={effectiveColumnValue(record, 'display_name') || ''}
          onSave={(val) => setColumnPending(record.id, { display_name: val })}
          placeholder="设置显示名"
        />
      ),
    },
    {
      title: '标签', key: 'tags', width: 200,
      render: (_: any, record: DictionaryColumn) => (
        <Select
          mode="tags"
          value={effectiveColumnValue(record, 'tags') || []}
          onChange={(tags) => setColumnPending(record.id, { tags })}
          style={{ width: '100%' }}
          size="small"
          placeholder="添加标签"
          tokenSeparators={[',']}
          disabled={!canEdit}
        />
      ),
    },
  ];

  const indexColumns = [
    { title: '索引名', dataIndex: 'index_name', key: 'name' },
    { title: '类型', dataIndex: 'index_type', key: 'type' },
    {
      title: '字段', key: 'columns',
      render: (_: any, record: any) => (
        <Space>{(record.columns || []).map((c: string) => <Tag key={c}>{c}</Tag>)}</Space>
      ),
    },
    {
      title: '唯一', dataIndex: 'is_unique', key: 'unique',
      render: (v: number) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag>,
    },
  ];

  const generateDDL = (table: typeof selectedTable) => {
    if (!table) return '';
    let ddl = `CREATE TABLE ${table.table_name} (\n`;
    const cols = (table.columns || []).map((c) => {
      let line = `  ${c.column_name} ${c.column_type}`;
      if (c.is_nullable === 'NO') line += ' NOT NULL';
      if (c.column_default !== null && c.column_default !== undefined) line += ` DEFAULT ${c.column_default}`;
      if (c.extra) line += ` ${c.extra}`;
      if (c.column_comment) line += ` COMMENT '${c.column_comment}'`;
      return line;
    });
    ddl += cols.join(',\n');
    const pkCols = (table.columns || []).filter((c) => c.column_key === 'PRI');
    if (pkCols.length) ddl += `,\n  PRIMARY KEY (${pkCols.map((c) => c.column_name).join(', ')})`;
    ddl += '\n)';
    if (table.engine) ddl += ` ENGINE=${table.engine}`;
    if (table.table_comment) ddl += ` COMMENT='${table.table_comment}'`;
    ddl += ';';
    return ddl;
  };

  const detailTabs = selectedTable ? [
    {
      key: 'columns',
      label: `字段 (${selectedTable.columns?.length || 0})`,
      children: <Table dataSource={selectedTable.columns} columns={columnTableColumns} rowKey="id" size="small" pagination={false} scroll={{ y: 500 }} />,
    },
    {
      key: 'indexes',
      label: `索引 (${selectedTable.indexes?.length || 0})`,
      children: <Table dataSource={selectedTable.indexes} columns={indexColumns} rowKey="id" size="small" pagination={false} />,
    },
    {
      key: 'ddl',
      label: 'DDL',
      children: <pre style={{ background: '#f5f5f5', padding: 16, borderRadius: 4, overflow: 'auto', fontSize: 13, fontFamily: 'monospace' }}>{generateDDL(selectedTable)}</pre>,
    },
    {
      key: 'data-preview',
      label: '数据预览',
      children: (
        <>
          {sampleLoading && (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          )}
          {sampleError && !sampleLoading && (
            <Alert type="error" message={sampleError} style={{ margin: 16 }} />
          )}
          {sampleData && !sampleLoading && !sampleError && (
            sampleData.columns.length === 0 ? (
              <Alert type="info" message="该表无数据" style={{ margin: 16 }} />
            ) : (
              <Table
                dataSource={sampleData.rows.map((row, i) => {
                  const obj: Record<string, any> = { _rowIndex: i + 1 };
                  sampleData.columns.forEach((col, j) => { obj[col] = row[j]; });
                  return obj;
                })}
                columns={[
                  { title: '#', dataIndex: '_rowIndex', key: '_rowIndex', width: 50, fixed: 'left' },
                  ...sampleData.columns.map((col) => ({
                    title: col,
                    dataIndex: col,
                    key: col,
                    ellipsis: true,
                    render: (val: any) => {
                      if (val === null) return <Text type="secondary">NULL</Text>;
                      if (typeof val === 'object') return JSON.stringify(val);
                      return String(val);
                    },
                  })),
                ]}
                rowKey="_rowIndex"
                size="small"
                scroll={{ x: 'max-content', y: 400 }}
                pagination={false}
              />
            )
          )}
        </>
      ),
    },
  ] : [];

  // ====== Procedure detail tabs ======
  const procParamColumns = [
    { title: '#', key: 'idx', width: 50, render: (_: any, __: any, i: number) => i + 1 },
    {
      title: '模式', dataIndex: 'mode', key: 'mode', width: 80,
      render: (v: string) => (
        <Tag color={v === 'OUT' ? 'orange' : v === 'INOUT' ? 'purple' : 'blue'}>{v || 'IN'}</Tag>
      ),
    },
    {
      title: '参数名', dataIndex: 'name', key: 'name',
      render: (v: string) => <Text strong code>{v}</Text>,
    },
    {
      title: '类型', dataIndex: 'type', key: 'type',
      render: (v: string) => <Text code>{v}</Text>,
    },
    { title: '默认值', dataIndex: 'default', key: 'default', render: (v: any) => v ?? '-' },
  ];

  const procDetailTabs = selectedProcedure ? [
    {
      key: 'overview',
      label: '概览',
      children: (
        <Card size="small">
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <Text strong style={{ fontSize: 16 }}>{selectedProcedure.procedure_name}</Text>{' '}
              <Tag color={selectedProcedure.procedure_type === 'FUNCTION' ? 'green' : 'blue'}>
                {selectedProcedure.procedure_type}
              </Tag>
              {selectedProcedure.return_type && (
                <Text type="secondary"> 返回 <Text code>{selectedProcedure.return_type}</Text></Text>
              )}
            </div>
            {selectedProcedure.last_modified && (
              <Text type="secondary" style={{ fontSize: 12 }}>最后修改: {selectedProcedure.last_modified}</Text>
            )}
            {selectedProcedure.procedure_comment && (
              <div><Text type="secondary">数据库注释: {selectedProcedure.procedure_comment}</Text></div>
            )}
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>自定义注释</Text>
              {canEdit ? (
                <TextArea
                  rows={3}
                  value={effectiveProcedureCustom(selectedProcedure)}
                  onChange={(e) => setProcedurePending(selectedProcedure.id, { custom_comment: e.target.value })}
                  placeholder="为这个存储过程添加自定义说明"
                />
              ) : (
                <div style={{ padding: 8, background: '#fafafa', borderRadius: 4 }}>
                  {selectedProcedure.custom_comment || <Text type="secondary">暂无</Text>}
                </div>
              )}
            </div>
          </Space>
        </Card>
      ),
    },
    {
      key: 'params',
      label: `参数 (${selectedProcedure.parameters?.length || 0})`,
      children: (
        <Table
          dataSource={selectedProcedure.parameters || []}
          columns={procParamColumns}
          rowKey={(_, i) => `${selectedProcedure.id}-${i}`}
          size="small"
          pagination={false}
        />
      ),
    },
    {
      key: 'definition',
      label: '定义',
      children: (
        <pre style={{
          background: '#f5f5f5', padding: 16, borderRadius: 4, overflow: 'auto',
          fontSize: 13, fontFamily: 'monospace', maxHeight: 600, whiteSpace: 'pre-wrap',
        }}>
          {selectedProcedure.definition || '(未获取到定义)'}
        </pre>
      ),
    },
  ] : [];

  // ====== Tables Tab content ======
  const tablesTabContent = (
    <Layout style={{ height: 'calc(100vh - 320px)', background: 'transparent' }}>
      <Sider width={300} style={{ background: '#fff', borderRight: '1px solid #f0f0f0', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px' }}>
          <Search placeholder="搜索表名/注释..." allowClear onChange={(e) => setSearchText(e.target.value)} size="small" />
        </div>
        <div style={{ overflowY: 'auto', height: 'calc(100% - 80px)' }}>
          <List
            size="small"
            dataSource={filteredTables}
            renderItem={({ table, matchedColumnNames }) => (
              <List.Item
                onClick={() => selectTable(table.id)}
                style={{
                  cursor: 'pointer',
                  padding: '8px 16px',
                  background: table.id === selectedTableId ? '#e6f4ff' : undefined,
                  borderLeft: table.id === selectedTableId ? '3px solid #1677ff' : '3px solid transparent',
                }}
              >
                <div style={{ width: '100%' }}>
                  <div style={{ fontWeight: table.id === selectedTableId ? 600 : 400, fontSize: 13 }}>
                    {table.table_name}
                    {matchedColumnNames.length > 0 && (
                      <Tooltip title={`匹配的字段: ${matchedColumnNames.join(', ')}`}>
                        <Tag color="blue" style={{ marginLeft: 8, fontSize: 10 }}>
                          匹配{matchedColumnNames.length}列
                        </Tag>
                      </Tooltip>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                    {table.engine && <span>{table.engine}</span>}
                    <span style={{ marginLeft: 8 }}>{table.row_count} 行</span>
                    <span style={{ marginLeft: 8 }}>{table.columns?.length || 0} 列</span>
                  </div>
                </div>
              </List.Item>
            )}
          />
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid #f0f0f0', fontSize: 12, color: '#999' }}>
          共 {filteredTables.length} / {tables.length} 张表
          {searchText.trim() && (
            <span style={{ marginLeft: 8 }}>
              (列匹配: {filteredTables.reduce((sum, item) => sum + item.matchedColumnNames.length, 0)})
            </span>
          )}
        </div>
      </Sider>
      <Content style={{ padding: '0 16px', overflow: 'auto' }}>
        {selectedTable ? (
          <>
            <Card size="small" style={{ marginBottom: 16 }}>
              <Space size={24}>
                <div><Text strong style={{ fontSize: 16 }}>{selectedTable.table_name}</Text></div>
                <div><Text type="secondary">{selectedTable.engine}</Text></div>
                <div><Text type="secondary">{selectedTable.row_count} 行</Text></div>
              </Space>
              {selectedTable.table_comment && (
                <div style={{ marginTop: 8 }}><Text type="secondary">注释: {selectedTable.table_comment}</Text></div>
              )}
              <div style={{ marginTop: 12 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>自定义注释</Text>
                {canEdit ? (
                  <TextArea
                    rows={2}
                    value={pendingTableChanges[selectedTable.id]?.custom_comment ?? selectedTable.custom_comment ?? ''}
                    onChange={(e) => setTablePending(selectedTable.id, { custom_comment: e.target.value })}
                    placeholder="为这张表添加自定义说明"
                  />
                ) : (
                  <div style={{ padding: 8, background: '#fafafa', borderRadius: 4 }}>
                    {selectedTable.custom_comment || <Text type="secondary">暂无</Text>}
                  </div>
                )}
              </div>
            </Card>
            <Tabs items={detailTabs} size="small" activeKey={detailTabKey} onChange={setDetailTabKey} />
          </>
        ) : (
          <Empty description="请从左侧选择一张表" style={{ marginTop: 100 }} />
        )}
      </Content>
    </Layout>
  );

  // ====== Procedures Tab content ======
  const proceduresTabContent = (
    <Layout style={{ height: 'calc(100vh - 320px)', background: 'transparent' }}>
      <Sider width={320} style={{ background: '#fff', borderRight: '1px solid #f0f0f0', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px' }}>
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Search placeholder="搜索过程/函数..." allowClear onChange={(e) => setProcSearchText(e.target.value)} size="small" />
            <Select
              size="small"
              style={{ width: '100%' }}
              value={procTypeFilter}
              onChange={setProcTypeFilter}
              options={[
                { value: 'all', label: '全部类型' },
                { value: 'PROCEDURE', label: 'PROCEDURE' },
                { value: 'FUNCTION', label: 'FUNCTION' },
              ]}
            />
          </Space>
        </div>
        <div style={{ overflowY: 'auto', height: 'calc(100% - 110px)' }}>
          <List
            size="small"
            dataSource={filteredProcedures}
            renderItem={(proc) => (
              <List.Item
                onClick={() => selectProcedure(proc.id)}
                style={{
                  cursor: 'pointer',
                  padding: '8px 16px',
                  background: proc.id === selectedProcedureId ? '#e6f4ff' : undefined,
                  borderLeft: proc.id === selectedProcedureId ? '3px solid #1677ff' : '3px solid transparent',
                }}
              >
                <div style={{ width: '100%' }}>
                  <div style={{ fontWeight: proc.id === selectedProcedureId ? 600 : 400, fontSize: 13 }}>
                    {proc.procedure_name}
                  </div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                    <Tag color={proc.procedure_type === 'FUNCTION' ? 'green' : 'blue'} style={{ fontSize: 10, lineHeight: '14px', padding: '0 4px', marginRight: 4 }}>
                      {proc.procedure_type}
                    </Tag>
                    {proc.parameters?.length || 0} 参数
                  </div>
                </div>
              </List.Item>
            )}
          />
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid #f0f0f0', fontSize: 12, color: '#999' }}>
          共 {filteredProcedures.length} / {procedures.length} 个
        </div>
      </Sider>
      <Content style={{ padding: '0 16px', overflow: 'auto' }}>
        {selectedProcedure ? (
          <Tabs items={procDetailTabs} size="small" />
        ) : (
          <Empty description={procedures.length === 0 ? '当前版本无存储过程' : '请从左侧选择一项'} style={{ marginTop: 100 }} />
        )}
      </Content>
    </Layout>
  );

  return (
    <div>
      <Card
        size="small"
        style={{ marginBottom: 16 }}
        styles={{ body: { padding: 16 } }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => guardedNavigate(-1)}>返回</Button>
            <Title level={5} style={{ margin: 0 }}>
              <TableOutlined /> {projectName}{projectName && connectionName ? ' / ' : ''}{connectionName}
            </Title>
            <Text type="secondary">
              共 {tables.length} 张表 / {procedures.length} 个存储过程
            </Text>
            {currentVersion && (
              <Tag color={currentVersion.status === 'published' ? 'green' : 'orange'}>
                v{currentVersion.version_number} · {currentVersion.status === 'published' ? '已发布' : '草稿'}
              </Tag>
            )}
          </Space>
          <Space>
            <Select
              value={selectedVersion}
              onChange={handleVersionChange}
              style={{ width: 160 }}
              options={[
                { value: 'latest', label: '最新版本' },
                ...publishedVersions.map((v) => ({
                  value: String(v.version_number),
                  label: `v${v.version_number}`,
                })),
              ]}
            />
            <Button
              icon={<HistoryOutlined />}
              onClick={() => guardedNavigate(`/connections/${connectionId}/versions`)}
            >
              版本历史
            </Button>
            <Button onClick={openDraftBox}>
              草稿箱
            </Button>
            {canSync && (
              <Button icon={<SyncOutlined />} loading={syncing} onClick={handleSync} type="default">
                同步
              </Button>
            )}
            {canSave && (
              <Badge count={pendingCount} offset={[-6, 6]} overflowCount={99}>
                <Button
                  type={pendingCount > 0 ? 'primary' : 'default'}
                  icon={<SaveOutlined />}
                  onClick={handleSave}
                  disabled={pendingCount === 0}
                >
                  保存
                </Button>
              </Badge>
            )}
            {canPublish && currentVersion && (
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                disabled={pendingCount > 0}
                onClick={() => {
                  if (pendingCount > 0) {
                    message.warning('请先保存当前修改');
                    return;
                  }
                  setPublishOpen(true);
                }}
              >
                发布
              </Button>
            )}
            <Select
              placeholder="导出"
              style={{ width: 120 }}
              loading={exporting}
              onChange={(format) => handleExport(format)}
              options={[
                { value: 'html', label: '导出 HTML' },
                { value: 'excel', label: '导出 Excel' },
                { value: 'pdf', label: '导出 PDF' },
              ]}
            />
          </Space>
        </div>
        {pendingCount > 0 && (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message={`有 ${pendingCount} 处未保存的改动`}
            description="系统只保留已发布的字典版本。修改需要先「保存」为草稿，再「发布」为正式版本。退出页面后草稿将被丢弃。"
          />
        )}
      </Card>

      <Tabs
        activeKey={topTab}
        onChange={setTopTab}
        items={[
          {
            key: 'tables',
            label: <span><TableOutlined /> 数据表 ({tables.length})</span>,
            children: tablesTabContent,
          },
          {
            key: 'procedures',
            label: <span><FunctionOutlined /> 存储过程 ({procedures.length})</span>,
            children: proceduresTabContent,
          },
        ]}
      />

      {/* Sync diff drawer */}
      <Drawer
        title="数据库结构差异"
        open={syncDrawerOpen}
        onClose={() => { setSyncDrawerOpen(false); clearSyncDiff(); }}
        width={720}
        footer={
          <Space>
            <Button onClick={() => { setSyncDrawerOpen(false); clearSyncDiff(); }}>取消</Button>
            <Button type="primary" onClick={handleApplySync} loading={syncing}>
              应用并保存为新草稿
            </Button>
          </Space>
        }
      >
        {syncDiffLoading ? (
          <Spin />
        ) : !syncDiff ? (
          <Empty description="无差异" />
        ) : (() => {
          const total = (syncDiff.tables_added?.length || 0)
            + (syncDiff.tables_removed?.length || 0)
            + (syncDiff.tables_changed?.length || 0)
            + (syncDiff.procedures_added?.length || 0)
            + (syncDiff.procedures_removed?.length || 0)
            + (syncDiff.procedures_changed?.length || 0);
          if (total === 0) {
            return (
              <Result
                status="success"
                title="已是最新"
                subTitle="数据库结构与本系统当前最新版本一致，无需同步"
              />
            );
          }
          return (
            <>
              <Alert
                type="info" showIcon style={{ marginBottom: 12 }}
                message={`共发现 ${total} 处差异 — 表：新增 ${syncDiff.tables_added?.length || 0}、删除 ${syncDiff.tables_removed?.length || 0}、变更 ${syncDiff.tables_changed?.length || 0}；存储过程：新增 ${syncDiff.procedures_added?.length || 0}、删除 ${syncDiff.procedures_removed?.length || 0}、变更 ${syncDiff.procedures_changed?.length || 0}`}
              />
              {syncDiff.tables_added?.length > 0 && (
                <Card type="inner" title={`新增表 (${syncDiff.tables_added.length})`} style={{ marginBottom: 12 }}>
                  {syncDiff.tables_added.map((t: any) => (
                    <div key={t.table_name} style={{ marginBottom: 12 }}>
                      <Text strong>{t.table_name}</Text>{' '}
                      <Text type="secondary">{t.columns?.length || 0} 列</Text>
                      <div style={{ marginTop: 4 }}>
                        {t.columns.map((c: any) => (
                          <Space key={c.column_name} size={4} style={{ marginBottom: 4, display: 'flex' }}>
                            <Tag color="green" style={{ minWidth: 80 }}>{c.column_name}</Tag>
                            <Text code style={{ fontSize: 12 }}>{c.column_type}</Text>
                            <Input
                              size="small" placeholder="自定义注释"
                              style={{ width: 200 }}
                              onChange={(e) => setSyncOverride(`${t.table_name}.${c.column_name}`, { custom_comment: e.target.value })}
                            />
                          </Space>
                        ))}
                      </div>
                    </div>
                  ))}
                </Card>
              )}
              {syncDiff.tables_removed?.length > 0 && (
                <Card type="inner" title={`删除表 (${syncDiff.tables_removed.length})`} style={{ marginBottom: 12 }}>
                  {syncDiff.tables_removed.map((n: string) => (
                    <Tag key={n} color="red">{n}</Tag>
                  ))}
                </Card>
              )}
              {syncDiff.tables_changed?.length > 0 && (
                <Card type="inner" title={`变更表 (${syncDiff.tables_changed.length})`} style={{ marginBottom: 12 }}>
                  {syncDiff.tables_changed.map((t: any) => (
                    <div key={t.table_name} style={{ marginBottom: 12 }}>
                      <Text strong>{t.table_name}</Text>
                      {t.comment_changed && (
                        <div style={{ fontSize: 12 }}>
                          <Text type="secondary">注释: </Text>
                          <Text delete>{t.comment_changed.old}</Text> → {t.comment_changed.new}
                        </div>
                      )}
                      {t.columns_added?.length > 0 && (
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>新增字段：</Text>
                          {t.columns_added.map((c: any) => (
                            <Tag key={c.column_name} color="green">{c.column_name}</Tag>
                          ))}
                        </div>
                      )}
                      {t.columns_removed?.length > 0 && (
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>删除字段：</Text>
                          {t.columns_removed.map((c: string) => (
                            <Tag key={c} color="red">{c}</Tag>
                          ))}
                        </div>
                      )}
                      {t.columns_changed?.length > 0 && (
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>变更字段：</Text>
                          {t.columns_changed.map((c: any) => (
                            <Tag key={c.column_name} color="orange">{c.column_name}</Tag>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </Card>
              )}
              {syncDiff.procedures_added?.length > 0 && (
                <Card type="inner" title={`新增存储过程 (${syncDiff.procedures_added.length})`} style={{ marginBottom: 12 }}>
                  {syncDiff.procedures_added.map((p: any) => (
                    <Space key={p.procedure_name} size={4} style={{ marginBottom: 4, display: 'flex' }}>
                      <Tag color={p.procedure_type === 'FUNCTION' ? 'green' : 'blue'} style={{ minWidth: 90 }}>
                        {p.procedure_type}
                      </Tag>
                      <Text strong code>{p.procedure_name}</Text>
                      <Input
                        size="small" placeholder="自定义注释"
                        style={{ width: 240 }}
                        onChange={(e) => setSyncOverride(`procedure:${p.procedure_name}`, { custom_comment: e.target.value })}
                      />
                    </Space>
                  ))}
                </Card>
              )}
              {syncDiff.procedures_removed?.length > 0 && (
                <Card type="inner" title={`删除存储过程 (${syncDiff.procedures_removed.length})`} style={{ marginBottom: 12 }}>
                  {syncDiff.procedures_removed.map((n: string) => (
                    <Tag key={n} color="red">{n}</Tag>
                  ))}
                </Card>
              )}
              {syncDiff.procedures_changed?.length > 0 && (
                <Card type="inner" title={`变更存储过程 (${syncDiff.procedures_changed.length})`}>
                  {syncDiff.procedures_changed.map((p: any) => (
                    <div key={p.procedure_name} style={{ marginBottom: 6 }}>
                      <Tag color="orange">{p.procedure_name}</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {[
                          p.type_changed && '类型',
                          p.return_type_changed && '返回类型',
                          p.parameters_changed && '参数',
                          p.definition_changed && '定义',
                          p.comment_changed && '注释',
                        ].filter(Boolean).join('、')}
                      </Text>
                    </div>
                  ))}
                </Card>
              )}
            </>
          );
        })()}
      </Drawer>

      {/* Publish modal */}
      <Modal
        title="发布字典版本"
        open={publishOpen}
        onCancel={() => { setPublishOpen(false); publishForm.resetFields(); }}
        onOk={handlePublish}
        okText="确认发布"
        cancelText="取消"
        width={520}
      >
        <Form form={publishForm} layout="vertical">
          <Form.Item
            name="notes"
            label="发布备注"
            rules={[{ required: true, message: '请填写发布说明' }]}
          >
            <TextArea rows={4} placeholder="本次发布的主要变更/说明" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Draft box drawer */}
      <Drawer
        title="草稿箱"
        open={draftDrawerOpen}
        onClose={() => setDraftDrawerOpen(false)}
        width={520}
      >
        {draftsLoading ? (
          <Spin />
        ) : drafts.length === 0 ? (
          <Empty description="暂无草稿" />
        ) : (
          <List
            dataSource={drafts}
            renderItem={(draft: any) => (
              <List.Item
                actions={[
                  <Button type="link" size="small" onClick={() => handleViewDraft(draft)}>查看</Button>,
                  <Button type="link" size="small" onClick={() => handlePublishDraft(draft)}>发布</Button>,
                  <Button type="link" size="small" danger onClick={() => handleDeleteDraft(draft)}>删除</Button>,
                ]}
              >
                <List.Item.Meta
                  title={<span>v{draft.version_number} · {draft.connection_name}</span>}
                  description={`创建于 ${draft.created_at}`}
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>
    </div>
  );
};

export default DictionaryBrowser;
