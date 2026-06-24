import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Card, Tabs, Descriptions, Table, Tag, Button, Form, Input, Spin,
  message, Space, Popconfirm, Typography, Result, Alert,
  Switch, Select, DatePicker, Badge, InputNumber, Tooltip,
} from 'antd';
import {
  DatabaseOutlined, TeamOutlined, LinkOutlined, TableOutlined,
  ApiOutlined, CheckCircleOutlined, CloudUploadOutlined,
  DownloadOutlined, DeleteOutlined, ReloadOutlined, ClockCircleOutlined,
  AuditOutlined, UserSwitchOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { systemApi } from '../../api/system';
import { auditApi, AuditOnlineUser, AuditLogEntry, AuditLogQuery } from '../../api/audit';

const { Text, Title, Paragraph } = Typography;
const { RangePicker } = DatePicker;

const fmtTime = (v: string | null | undefined) =>
  v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-';

// ----- Category / action display dictionaries -----

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  auth: { label: '认证', color: 'blue' },
  sync: { label: '同步', color: 'cyan' },
  dictionary: { label: '字典', color: 'geekblue' },
  user_mgmt: { label: '用户管理', color: 'purple' },
  role_mgmt: { label: '角色管理', color: 'magenta' },
  system: { label: '系统', color: 'gold' },
};

const ACTION_LABELS: Record<string, string> = {
  'login.success': '登录成功',
  'login.fail': '登录失败',
  'logout': '登出',
  'password.change': '修改密码',
  'sync.preview': '预览同步',
  'sync.apply': '应用同步',
  'sync.full': '一键同步',
  'dictionary.publish': '发布字典',
  'dictionary.rollback': '回滚字典',
  'dictionary.delete_version': '删除版本',
  'user.create': '新建用户',
  'user.delete': '删除用户',
  'user.update_role': '修改角色字段',
  'user.set_roles': '分配角色',
  'user.update_display_name': '修改显示名',
  'user.reset_password': '重置密码',
  'role.create': '新建角色',
  'role.update': '更新角色',
  'role.delete': '删除角色',
  'audit.clear': '清空审计',
};

const ACTIONS_BY_CATEGORY: Record<string, string[]> = {
  auth: ['login.success', 'login.fail', 'logout', 'password.change'],
  sync: ['sync.preview', 'sync.apply', 'sync.full'],
  dictionary: ['dictionary.publish', 'dictionary.rollback', 'dictionary.delete_version'],
  user_mgmt: [
    'user.create',
    'user.delete',
    'user.update_role',
    'user.set_roles',
    'user.update_display_name',
    'user.reset_password',
  ],
  role_mgmt: ['role.create', 'role.update', 'role.delete'],
  system: ['audit.clear'],
};

// ----- Online users tab -----

const OnlineTab: React.FC = () => {
  const [data, setData] = useState<AuditOnlineUser[]>([]);
  const [stats, setStats] = useState<{ online: number; total: number }>({ online: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (showSpin = false) => {
    if (showSpin) setLoading(true);
    try {
      const r = await auditApi.listOnline();
      setData(r.users);
      setStats({ online: r.online, total: r.total });
    } catch {
      message.error('加载在线情况失败');
    }
    if (showSpin) setLoading(false);
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(() => void load(false), 30_000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [autoRefresh, load]);

  const columns = [
    {
      title: '状态',
      dataIndex: 'online',
      width: 80,
      render: (online: boolean, row: AuditOnlineUser) => (
        <Tooltip title={online ? '当前在线' : `离线 (最近活跃: ${fmtTime(row.last_seen_at)})`}>
          <Badge status={online ? 'success' : 'default'} text={online ? '在线' : '离线'} />
        </Tooltip>
      ),
    },
    { title: '账号', dataIndex: 'username', width: 140 },
    {
      title: '名称',
      dataIndex: 'display_name',
      width: 160,
      render: (v: string) => v || <Text type="secondary">-</Text>,
    },
    {
      title: '角色',
      dataIndex: 'roles',
      render: (rs: string[]) =>
        rs && rs.length ? rs.map((r) => <Tag key={r}>{r}</Tag>) : <Text type="secondary">-</Text>,
    },
    {
      title: '最近活跃',
      dataIndex: 'last_seen_at',
      width: 180,
      render: fmtTime,
    },
    {
      title: '最近登录',
      dataIndex: 'last_login_at',
      width: 180,
      render: fmtTime,
    },
    {
      title: '登录 IP',
      dataIndex: 'last_login_ip',
      width: 160,
      render: (v: string | null) => v || <Text type="secondary">-</Text>,
    },
  ];

  return (
    <Card
      title={
        <Space>
          <UserSwitchOutlined />
          <span>在线情况</span>
          <Tag color="green">在线 {stats.online}</Tag>
          <Tag>共 {stats.total} 人</Tag>
        </Space>
      }
      extra={
        <Space>
          <Text type="secondary">自动刷新 (30s)</Text>
          <Switch checked={autoRefresh} onChange={setAutoRefresh} />
          <Button icon={<ReloadOutlined />} onClick={() => load(true)}>刷新</Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={data}
        columns={columns}
        pagination={{ pageSize: 50, showSizeChanger: true }}
      />
    </Card>
  );
};

// ----- Audit log tab -----

const AuditTab: React.FC = () => {
  const [data, setData] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [category, setCategory] = useState<string | undefined>();
  const [action, setAction] = useState<string | undefined>();
  const [actor, setActor] = useState<string>('');
  const [resultFilter, setResultFilter] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [q, setQ] = useState('');
  const [clearDays, setClearDays] = useState<number | null>(30);

  const query = useMemo<AuditLogQuery>(() => {
    const p: AuditLogQuery = { page, pageSize };
    if (category) p.category = category;
    if (action) p.action = action;
    if (actor.trim()) p.actor = actor.trim();
    if (resultFilter) p.result = resultFilter as 'success' | 'failure';
    if (q.trim()) p.q = q.trim();
    if (range?.[0]) p.from = range[0].toISOString();
    if (range?.[1]) p.to = range[1].toISOString();
    return p;
  }, [page, pageSize, category, action, actor, resultFilter, q, range]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await auditApi.listLogs(query);
      setData(r.data);
      setTotal(r.pagination.total);
    } catch {
      message.error('加载操作日志失败');
    }
    setLoading(false);
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  const handleExport = async () => {
    try {
      const blob = await auditApi.exportLogs(query);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${dayjs().format('YYYYMMDD-HHmmss')}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      message.success('已导出 CSV');
    } catch {
      message.error('导出失败');
    }
  };

  const handleClear = async () => {
    try {
      const before = clearDays && clearDays > 0
        ? dayjs().subtract(clearDays, 'day').toISOString()
        : undefined;
      const r = await auditApi.clearLogs(before);
      message.success(`已清空 ${r.deleted} 条`);
      setPage(1);
      void load();
    } catch {
      message.error('清空失败');
    }
  };

  const actionOptions = useMemo(() => {
    const codes = category ? (ACTIONS_BY_CATEGORY[category] || []) : Object.keys(ACTION_LABELS);
    return codes.map((c) => ({ value: c, label: ACTION_LABELS[c] || c }));
  }, [category]);

  const columns = [
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 170,
      render: fmtTime,
    },
    {
      title: '类别',
      dataIndex: 'category',
      width: 90,
      render: (c: string) => {
        const def = CATEGORY_LABELS[c] || { label: c, color: 'default' };
        return <Tag color={def.color}>{def.label}</Tag>;
      },
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 130,
      render: (a: string) => ACTION_LABELS[a] || a,
    },
    {
      title: '操作人',
      dataIndex: 'actor_username',
      width: 160,
      render: (v: string, row: AuditLogEntry) =>
        v
          ? (
            <span>
              {row.actor_display_name ? `${row.actor_display_name} (${v})` : v}
            </span>
          )
          : <Text type="secondary">匿名</Text>,
    },
    {
      title: '目标',
      dataIndex: 'target_label',
      render: (v: string, row: AuditLogEntry) => {
        if (!v && !row.target_type) return <Text type="secondary">-</Text>;
        return (
          <span>
            {row.target_type && <Tag>{row.target_type}</Tag>}
            {v}
          </span>
        );
      },
    },
    {
      title: '结果',
      dataIndex: 'result',
      width: 80,
      render: (r: string) => (
        <Tag color={r === 'success' ? 'green' : 'red'}>{r === 'success' ? '成功' : '失败'}</Tag>
      ),
    },
    {
      title: 'IP',
      dataIndex: 'ip_address',
      width: 140,
      render: (v: string) => v || <Text type="secondary">-</Text>,
    },
    {
      title: '消息',
      dataIndex: 'message',
      ellipsis: true,
      render: (v: string) => v || <Text type="secondary">-</Text>,
    },
  ];

  return (
    <Card
      title={<Space><AuditOutlined /><span>操作日志</span></Space>}
      extra={
        <Space>
          <Button icon={<DownloadOutlined />} onClick={handleExport}>导出 CSV</Button>
          <Popconfirm
            title="清空操作日志"
            description={
              <div>
                <div>清空多少天前的日志？留空则全部清空。</div>
                <InputNumber
                  min={0}
                  placeholder="天数"
                  value={clearDays ?? undefined}
                  onChange={(v) => setClearDays(v ?? null)}
                  style={{ width: 120, marginTop: 8 }}
                />
              </div>
            }
            okText="确认清空"
            okButtonProps={{ danger: true }}
            onConfirm={handleClear}
          >
            <Button danger icon={<DeleteOutlined />}>清空</Button>
          </Popconfirm>
        </Space>
      }
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder="类别"
          style={{ width: 130 }}
          value={category}
          onChange={(v) => { setCategory(v); setAction(undefined); setPage(1); }}
          options={Object.entries(CATEGORY_LABELS).map(([k, v]) => ({ value: k, label: v.label }))}
        />
        <Select
          allowClear
          placeholder="动作"
          style={{ width: 180 }}
          value={action}
          onChange={(v) => { setAction(v); setPage(1); }}
          options={actionOptions}
          showSearch
          optionFilterProp="label"
        />
        <Input
          allowClear
          placeholder="操作人 (用户名)"
          style={{ width: 160 }}
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          onPressEnter={() => { setPage(1); void load(); }}
        />
        <Select
          allowClear
          placeholder="结果"
          style={{ width: 110 }}
          value={resultFilter}
          onChange={(v) => { setResultFilter(v); setPage(1); }}
          options={[
            { value: 'success', label: '成功' },
            { value: 'failure', label: '失败' },
          ]}
        />
        <RangePicker
          showTime
          value={range as any}
          onChange={(v) => { setRange(v as any); setPage(1); }}
        />
        <Input.Search
          placeholder="关键字 (操作人/目标/消息)"
          allowClear
          style={{ width: 240 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onSearch={() => { setPage(1); void load(); }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => load()}>刷新</Button>
      </Space>

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={data}
        columns={columns}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100, 200],
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          showTotal: (t) => `共 ${t} 条`,
        }}
        expandable={{
          expandedRowRender: (row) => {
            let parsed: any = null;
            if (row.metadata) {
              try { parsed = JSON.parse(row.metadata); } catch { parsed = row.metadata; }
            }
            return (
              <div style={{ background: '#fafafa', padding: 12, borderRadius: 4 }}>
                <Paragraph style={{ marginBottom: 4 }}>
                  <Text type="secondary">UA：</Text>
                  <Text>{row.user_agent || '-'}</Text>
                </Paragraph>
                <Paragraph style={{ marginBottom: 0 }}>
                  <Text type="secondary">附加信息：</Text>
                </Paragraph>
                <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                  {parsed ? (typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)) : '-'}
                </pre>
              </div>
            );
          },
        }}
      />
    </Card>
  );
};

// ----- Page -----

const SystemAdmin: React.FC = () => {
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [configForm] = Form.useForm();
  const [configSaving, setConfigSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateDone, setMigrateDone] = useState(false);

  useEffect(() => {
    loadInfo();
  }, []);

  const loadInfo = async () => {
    setLoading(true);
    try {
      const data = await systemApi.getInfo();
      setInfo(data);
    } catch {
      message.error('加载系统信息失败');
    }
    setLoading(false);
  };

  const loadConfig = async () => {
    try {
      const data = await systemApi.getDatabaseConfig();
      configForm.setFieldsValue(data.mysql);
    } catch {
      message.error('加载数据库配置失败');
    }
  };

  const handleSaveConfig = async () => {
    try {
      const values = await configForm.validateFields();
      setConfigSaving(true);
      await systemApi.saveDatabaseConfig(values);
      message.success('配置已保存');
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err.response?.data?.error || '保存失败');
    }
    setConfigSaving(false);
  };

  const handleTestMysql = async () => {
    setTesting(true);
    try {
      // Save first, then test
      const values = await configForm.validateFields();
      await systemApi.saveDatabaseConfig(values);
      const result = await systemApi.testMysql();
      message[result.success ? 'success' : 'error'](result.message);
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error('测试失败');
    }
    setTesting(false);
  };

  const handleMigrate = async () => {
    setMigrating(true);
    try {
      const result = await systemApi.migrate();
      if (result.success) {
        setMigrateDone(true);
        message.success(result.message);
      } else {
        message.error(result.message);
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || '迁移失败');
    }
    setMigrating(false);
  };

  const tabItems = [
    {
      key: 'info',
      label: '系统信息',
      icon: <DatabaseOutlined />,
      children: loading ? <Spin style={{ display: 'block', margin: '40px auto' }} /> : (
        <Card>
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label={<><DatabaseOutlined /> 数据库类型</>}>
              <Tag color={info?.database_type === 'sqlite' ? 'orange' : 'blue'}>
                {info?.database_type === 'sqlite' ? 'SQLite' : 'MySQL'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={<><TeamOutlined /> 用户数</>}>{info?.users}</Descriptions.Item>
            <Descriptions.Item label={<><LinkOutlined /> 数据连接数</>}>{info?.connections}</Descriptions.Item>
            <Descriptions.Item label={<><ApiOutlined /> 字典版本数</>}>{info?.versions}</Descriptions.Item>
            <Descriptions.Item label={<><TableOutlined /> 字典表总数</>}>{info?.tables}</Descriptions.Item>
          </Descriptions>
        </Card>
      ),
    },
    {
      key: 'online',
      label: '在线情况',
      icon: <UserSwitchOutlined />,
      children: <OnlineTab />,
    },
    {
      key: 'audit',
      label: '操作日志',
      icon: <AuditOutlined />,
      children: <AuditTab />,
    },
    {
      key: 'dbconfig',
      label: '数据库配置',
      icon: <ClockCircleOutlined />,
      children: (
        <Card title="MySQL 连接配置" style={{ maxWidth: 600 }}>
          <Form
            form={configForm}
            layout="vertical"
            onFinish={handleSaveConfig}
            onFieldsChange={() => setMigrateDone(false)}
          >
            <Form.Item name="host" label="主机地址" rules={[{ required: true }]}>
              <Input placeholder="localhost" />
            </Form.Item>
            <Form.Item name="port" label="端口" rules={[{ required: true }]}>
              <Input type="number" placeholder="3306" />
            </Form.Item>
            <Form.Item name="database" label="数据库名" rules={[{ required: true }]}>
              <Input placeholder="dbwiki" />
            </Form.Item>
            <Form.Item name="user" label="用户名" rules={[{ required: true }]}>
              <Input placeholder="root" />
            </Form.Item>
            <Form.Item name="password" label="密码">
              <Input.Password placeholder="输入密码" />
            </Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={configSaving}>保存配置</Button>
              <Button onClick={handleTestMysql} loading={testing} icon={<CheckCircleOutlined />}>测试连接</Button>
            </Space>
          </Form>
        </Card>
      ),
    },
    {
      key: 'migrate',
      label: '数据迁移',
      icon: <CloudUploadOutlined />,
      children: (
        <Card style={{ maxWidth: 600 }}>
          {info && (
            <Alert
              type={info.database_type === 'sqlite' ? 'info' : 'success'}
              showIcon
              style={{ marginBottom: 16 }}
              message={
                info.database_type === 'sqlite'
                  ? '当前使用 SQLite，可迁移到 MySQL'
                  : '当前已使用 MySQL'
              }
            />
          )}
          {migrateDone ? (
            <Result
              status="success"
              title="迁移完成"
              subTitle="请重启服务使新数据库生效。重启后请确认所有功能正常。"
            />
          ) : info?.database_type === 'sqlite' ? (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text>将 SQLite 中的所有数据迁移到已配置的 MySQL 数据库。</Text>
              <Text type="secondary">迁移前请确保：</Text>
              <ul>
                <li>MySQL 连接配置正确且可连通</li>
                <li>目标数据库已创建</li>
                <li>目标数据库为空（无同名表冲突）</li>
                <li>迁移过程中请勿操作系统</li>
              </ul>
              <Popconfirm
                title="确认迁移？"
                description="迁移过程中请勿关闭页面，完成后需要重启服务。"
                onConfirm={handleMigrate}
              >
                <Button
                  type="primary"
                  icon={<CloudUploadOutlined />}
                  loading={migrating}
                  disabled={migrating}
                >
                  {migrating ? '迁移中...' : '开始迁移到 MySQL'}
                </Button>
              </Popconfirm>
            </Space>
          ) : (
            <Result status="info" title="当前已使用 MySQL" subTitle="无需迁移" />
          )}
        </Card>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>系统管理</Title>
      <Tabs items={tabItems} defaultActiveKey="info" onTabClick={(key) => { if (key === 'dbconfig') loadConfig(); }} />
    </div>
  );
};

export default SystemAdmin;
