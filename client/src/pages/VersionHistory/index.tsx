import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Timeline, Tag, Button, Space, Card, Typography, Modal, message, Select, Spin,
  Drawer, Table, Empty, Tabs, Descriptions, Input,
} from 'antd';
import {
  ArrowLeftOutlined, CheckCircleOutlined, DeleteOutlined, EditOutlined, HistoryOutlined,
  RollbackOutlined, ProfileOutlined,
} from '@ant-design/icons';
import { dictionaryApi } from '../../api/dictionary';
import { useAuthStore } from '../../stores/authStore';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;

const VersionHistory: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const connectionId = parseInt(id || '0');
  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = currentUser?.role === 'admin' || currentUser?.permissions?.includes('user:manage');
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishModal, setPublishModal] = useState<{ open: boolean; versionId: number | null }>({ open: false, versionId: null });
  const [publishNotes, setPublishNotes] = useState('');
  const [compareModal, setCompareModal] = useState<{ open: boolean; versionA: number | null; versionB: number | null }>({ open: false, versionA: null, versionB: null });
  const [diff, setDiff] = useState<any>(null);

  // Publish history Drawer
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);

  const fetchVersions = async () => {
    setLoading(true);
    try {
      const data = await dictionaryApi.getVersions(connectionId);
      // BUGFIX: backend returns the array directly, not `{ data: [...] }`
      // Only show published versions; drafts are internal and not listed.
      setVersions(Array.isArray(data) ? data.filter((v: any) => v.status === 'published') : []);
    } catch {
      message.error('加载版本失败');
    }
    setLoading(false);
  };

  const fetchPublishLogs = async () => {
    try {
      const data = await dictionaryApi.publishLogs(connectionId);
      setLogs(Array.isArray(data) ? data : []);
    } catch {
      message.error('加载发布历史失败');
    }
  };

  useEffect(() => { fetchVersions(); }, [connectionId]);

  const handlePublish = async () => {
    if (!publishModal.versionId) return;
    try {
      await dictionaryApi.publishVersion(publishModal.versionId, publishNotes);
      message.success('版本已发布');
      setPublishModal({ open: false, versionId: null });
      setPublishNotes('');
      fetchVersions();
    } catch (err: any) {
      message.error(err.response?.data?.error || '发布失败');
    }
  };

  const handleRollback = async (versionId: number) => {
    try {
      await dictionaryApi.rollbackVersion(versionId);
      message.success('已回滚创建新草稿');
      fetchVersions();
    } catch {
      message.error('回滚失败');
    }
  };

  const handleCompare = async () => {
    if (!compareModal.versionA || !compareModal.versionB) return;
    try {
      // BUGFIX: backend returns the diff object directly, not `{ data: ... }`
      const data = await dictionaryApi.compareVersions(compareModal.versionA, compareModal.versionB);
      setDiff(data);
    } catch {
      message.error('对比失败');
    }
  };

  const handleDelete = (version: any) => {
    Modal.confirm({
      title: '删除版本',
      content: (
        <div>
          <p>确定要删除 <Tag color="red">v{version.version_number}</Tag> 吗？</p>
          <p style={{ color: '#ff4d4f' }}>
            该操作不可恢复：版本本身、所有表/列/索引元数据以及发布历史都将被永久删除。
          </p>
          {version.status === 'published' && (
            <p style={{ color: '#faad14' }}>⚠️ 此版本为已发布状态，删除后无法回滚。</p>
          )}
        </div>
      ),
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await dictionaryApi.deleteVersion(version.id);
          message.success(`版本 v${version.version_number} 已删除`);
          fetchVersions();
        } catch (err: any) {
          message.error(err.response?.data?.error || '删除失败');
        }
      },
    });
  };

  const openPublishHistory = async () => {
    await fetchPublishLogs();
    setLogsOpen(true);
  };

  if (loading) return <Spin size="large" style={{ display: 'flex', justifyContent: 'center', padding: 100 }} />;

  const timelineItems = versions.map((v) => ({
    color: v.status === 'published' ? 'green' : 'orange',
    dot: v.status === 'published' ? <CheckCircleOutlined /> : <EditOutlined />,
    children: (
      <Card size="small" style={{ marginBottom: 8 }}>
        <Space wrap>
          <Tag color={v.status === 'published' ? 'green' : 'orange'}>
            v{v.version_number} ({v.status === 'published' ? '已发布' : '草稿'})
          </Tag>
          <Text type="secondary">由 {v.created_by_username || `用户#${v.created_by}`} 创建于 {dayjs(v.created_at).format('YYYY-MM-DD HH:mm')}</Text>
          {v.published_at && <Text type="secondary">发布于 {dayjs(v.published_at).format('YYYY-MM-DD HH:mm')}</Text>}
        </Space>
        {v.notes && <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>{v.notes}</Paragraph>}
        <div style={{ marginTop: 8 }}>
          <Space>
            <Button
              size="small"
              onClick={() => navigate(`/connections/${connectionId}/dictionary?version=${v.version_number}`)}
            >
              查看字典
            </Button>
            {v.status === 'draft' && (
              <Button
                size="small" type="primary"
                onClick={() => setPublishModal({ open: true, versionId: v.id })}
              >
                发布
              </Button>
            )}
            <Button
              size="small"
              onClick={() => setCompareModal({ open: true, versionA: v.id, versionB: null })}
            >
              对比
            </Button>
            {v.status === 'published' && (
              <Button size="small" icon={<RollbackOutlined />} onClick={() => handleRollback(v.id)}>
                回滚到此版本
              </Button>
            )}
            {isAdmin && (
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleDelete(v)}
              >
                删除
              </Button>
            )}
          </Space>
        </div>
      </Card>
    ),
  }));

  // Build the "modified" diff rows for the compare modal.
  const buildColumnChangeRows = (table: any) => {
    const rows: any[] = [];
    for (const col of table.columns || []) {
      if (col.change === 'added') {
        rows.push({ change: 'added', column_name: col.column_name, type: col.new?.column_type, defaultValue: col.new?.column_default });
      } else if (col.change === 'removed') {
        rows.push({ change: 'removed', column_name: col.column_name, type: col.old?.column_type, defaultValue: col.old?.column_default });
      } else if (col.change === 'modified') {
        rows.push({ change: 'modified', column_name: col.column_name, fields: col.fields });
      }
    }
    return rows;
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
          <Title level={5} style={{ margin: 0 }}>版本历史</Title>
        </Space>
        <Button icon={<ProfileOutlined />} onClick={openPublishHistory}>
          发布历史
        </Button>
      </div>

      {versions.length === 0 ? (
        <Card><Text type="secondary">暂无版本记录，请先同步数据库</Text></Card>
      ) : (
        <Timeline items={timelineItems} />
      )}

      {/* Publish Modal */}
      <Modal
        title="发布版本"
        open={publishModal.open}
        onOk={handlePublish}
        onCancel={() => { setPublishModal({ open: false, versionId: null }); setPublishNotes(''); }}
        okText="发布"
        cancelText="取消"
      >
        <Text>本次发布说明（必填）：</Text>
        <Input.TextArea
          value={publishNotes}
          onChange={(e) => setPublishNotes(e.target.value)}
          placeholder="简要说明本次发布的内容"
          rows={3}
        />
      </Modal>

      {/* Compare Modal */}
      <Modal
        title="版本对比"
        open={compareModal.open}
        onOk={handleCompare}
        onCancel={() => { setCompareModal({ open: false, versionA: null, versionB: null }); setDiff(null); }}
        okText="对比"
        cancelText="取消"
        width={840}
      >
        <Space style={{ marginBottom: 16 }}>
          <Select
            placeholder="版本 A（基线）"
            value={compareModal.versionA}
            onChange={(v) => setCompareModal((prev) => ({ ...prev, versionA: v }))}
            style={{ width: 200 }}
            options={versions.map((v) => ({ value: v.id, label: `v${v.version_number} (${v.status})` }))}
          />
          <Text>vs</Text>
          <Select
            placeholder="版本 B（对照）"
            value={compareModal.versionB}
            onChange={(v) => setCompareModal((prev) => ({ ...prev, versionB: v }))}
            style={{ width: 200 }}
            options={versions.map((v) => ({ value: v.id, label: `v${v.version_number} (${v.status})` }))}
          />
        </Space>
        {diff && (
          <div>
            <Space style={{ marginBottom: 16 }} wrap>
              <Tag color="green">+{diff.diff?.added?.length || 0} 表新增</Tag>
              <Tag color="red">-{diff.diff?.removed?.length || 0} 表移除</Tag>
              <Tag color="orange">{diff.diff?.changed?.length || 0} 表变更</Tag>
            </Space>
            {diff.diff?.added?.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <Text strong style={{ color: '#52c41a' }}>新增表: </Text>
                {diff.diff.added.map((t: string) => <Tag key={t} color="green">{t}</Tag>)}
              </div>
            )}
            {diff.diff?.removed?.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <Text strong style={{ color: '#ff4d4f' }}>移除表: </Text>
                {diff.diff.removed.map((t: string) => <Tag key={t} color="red">{t}</Tag>)}
              </div>
            )}
            {diff.diff?.changed?.map((t: any) => (
              <Card key={t.table_name} size="small" style={{ marginBottom: 8 }} title={t.table_name}>
                {t.table_comment_changed && (
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary">表注释变更：</Text>
                    <Text delete>{t.table_comment_changed.old || '（空）'}</Text> →{' '}
                    <Text>{t.table_comment_changed.new || '（空）'}</Text>
                  </div>
                )}
                {t.custom_comment_changed && (
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary">自定义注释变更：</Text>
                    <Text delete>{t.custom_comment_changed.old || '（空）'}</Text> →{' '}
                    <Text>{t.custom_comment_changed.new || '（空）'}</Text>
                  </div>
                )}
                {t.columns?.length > 0 && (
                  <Table
                    size="small"
                    dataSource={buildColumnChangeRows(t)}
                    rowKey={(r, idx) => `${r.column_name}-${idx}`}
                    pagination={false}
                    columns={[
                      {
                        title: '变更类型', dataIndex: 'change', width: 100,
                        render: (v: string) => {
                          if (v === 'added') return <Tag color="green">新增</Tag>;
                          if (v === 'removed') return <Tag color="red">删除</Tag>;
                          return <Tag color="orange">变更</Tag>;
                        },
                      },
                      { title: '列名', dataIndex: 'column_name', width: 150 },
                      {
                        title: '详情', key: 'detail',
                        render: (_: any, r: any) => {
                          if (r.change === 'added') return <Text>类型 {r.type || '?'}</Text>;
                          if (r.change === 'removed') return <Text type="secondary">已删除</Text>;
                          return (
                            <div>
                              {Object.entries(r.fields || {}).map(([field, vals]: any) => (
                                <div key={field} style={{ fontSize: 12 }}>
                                  <Text code>{field}</Text>：
                                  <Text delete>{String(vals.old ?? '')}</Text> →{' '}
                                  <Text>{String(vals.new ?? '')}</Text>
                                </div>
                              ))}
                            </div>
                          );
                        },
                      },
                    ]}
                  />
                )}
              </Card>
            ))}
            {!diff.diff?.added?.length && !diff.diff?.removed?.length && !diff.diff?.changed?.length && (
              <Empty description="两个版本内容一致" />
            )}
          </div>
        )}
      </Modal>

      {/* Publish history Drawer */}
      <Drawer
        title="发布历史"
        open={logsOpen}
        onClose={() => setLogsOpen(false)}
        width={560}
      >
        {logs.length === 0 ? (
          <Empty description="暂无发布记录" />
        ) : (
          <Tabs
            items={[
              {
                key: 'list',
                label: '列表',
                children: (
                  <Table
                    size="small"
                    dataSource={logs}
                    rowKey="id"
                    pagination={false}
                    columns={[
                      {
                        title: '版本',
                        dataIndex: 'version_number',
                        render: (v: number) => <Tag color="green">v{v}</Tag>,
                      },
                      {
                        title: '发布人',
                        dataIndex: 'published_by_username',
                        render: (v: string) => v || '-',
                      },
                      {
                        title: '发布时间',
                        dataIndex: 'published_at',
                        render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
                      },
                      { title: '备注', dataIndex: 'notes' },
                    ]}
                  />
                ),
              },
              {
                key: 'detail',
                label: '详情',
                children: (
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    {logs.map((l) => (
                      <Card key={l.id} size="small">
                        <Descriptions
                          column={1}
                          size="small"
                          items={[
                            { key: 'ver', label: '版本', children: <Tag color="green">v{l.version_number}</Tag> },
                            { key: 'who', label: '发布人', children: l.published_by_username || '-' },
                            { key: 'when', label: '发布时间', children: dayjs(l.published_at).format('YYYY-MM-DD HH:mm:ss') },
                            { key: 'notes', label: '备注', children: l.notes || '-' },
                          ]}
                        />
                      </Card>
                    ))}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
};

// Inline Input import is included at the top of the file.

export default VersionHistory;
