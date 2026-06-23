import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Tabs, Table, Button, Modal, Form, Input, Select, InputNumber,
  message, Popconfirm, Tag, Space, Card, Typography, Spin, Collapse,
  Alert, Result, Switch, Checkbox, Drawer,
} from 'antd';
import {
  PlusOutlined, SyncOutlined, EyeOutlined, ApiOutlined,
  DeleteOutlined, EditOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ThunderboltOutlined, SettingOutlined, TeamOutlined, LinkOutlined,
} from '@ant-design/icons';
import { projectsApi } from '../../api/projects';
import { connectionsApi } from '../../api/connections';
import { adminApi } from '../../api/admin';
import { rolesApi } from '../../api/roles';
import { useAuthStore } from '../../stores/authStore';
import type { Role, ProjectRoleBinding } from '../../types';

const { Title, Text } = Typography;
const { Panel } = Collapse;

const dbTypeColors: Record<string, string> = {
  mysql: 'blue', postgresql: 'geekblue', mssql: 'red', oracle: 'volcano',
  starrocks: 'purple', clickhouse: 'gold', influxdb: 'cyan',
};

const dbTypeDefaultPorts: Record<string, number> = {
  mysql: 3306, postgresql: 5432, mssql: 1433, oracle: 1521,
  starrocks: 9030, clickhouse: 8123, influxdb: 8086,
};

const ROLE_LABELS: Record<string, { name: string; color: string }> = {
  'project-admin': { name: '项目管理员', color: 'red' },
  'project-editor': { name: '项目编辑者', color: 'blue' },
  'project-viewer': { name: '项目查看者', color: 'default' },
  'system-admin': { name: '系统管理员', color: 'volcano' },
  'general-user': { name: '普通用户', color: 'green' },
};

const ProjectDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, hasPermission } = useAuthStore();
  const projectId = parseInt(id || '0');

  const [project, setProject] = useState<any>(null);
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Connection modal
  const [connModalOpen, setConnModalOpen] = useState(false);
  const [editingConn, setEditingConn] = useState<any>(null);
  const [connForm] = Form.useForm();
  const [connTesting, setConnTesting] = useState(false);
  const [connTestResult, setConnTestResult] = useState<null | { success: boolean; message: string; latency_ms: number }>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [syncing, setSyncing] = useState<number | null>(null);

  // Members
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [memberForm] = Form.useForm();
  const [userOptions, setUserOptions] = useState<any[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);

  // Roles (project role bindings)
  const [roleBindings, setRoleBindings] = useState<ProjectRoleBinding[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [bindRoleModalOpen, setBindRoleModalOpen] = useState(false);

  // Settings
  const [settingsForm] = Form.useForm();

  // Effective permissions for the current user on this project.
  const currentPerms: string[] = project?.current_user_permissions || [];
  const canManageMembers = hasPermission('project:member:manage') || currentPerms.includes('project:member:manage');
  const canManageConn = hasPermission('connection:manage') || currentPerms.includes('connection:manage');
  const canSync = hasPermission('connection:sync') || currentPerms.includes('connection:sync');
  const canEditProject = hasPermission('project:update') || currentPerms.includes('project:update');
  const canDeleteProject = hasPermission('project:delete') || currentPerms.includes('project:delete');
  const isSystemAdmin = user?.role === 'admin';

  const fetchProject = async () => {
    try {
      const p = await projectsApi.get(projectId);
      setProject(p);
      settingsForm.setFieldsValue({ name: p.name, description: p.description });
      return p;
    } catch {
      message.error('加载项目信息失败');
      return null;
    }
  };

  const fetchConnections = async () => {
    try {
      const conns = await connectionsApi.list(projectId);
      setConnections(Array.isArray(conns) ? conns : []);
    } catch {
      // ignore — empty is fine
    }
  };

  const fetchRoleBindings = async () => {
    try {
      const rb = await projectsApi.listRoleBindings(projectId);
      setRoleBindings(rb || []);
    } catch {
      // ignore
    }
  };

  const fetchRoles = async () => {
    try {
      const rs = await rolesApi.list();
      setAllRoles(rs || []);
    } catch {
      // ignore
    }
  };

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([fetchProject(), fetchConnections(), fetchRoleBindings()]);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    fetchRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ===== Connection actions =================================================

  const handleTestFromForm = async () => {
    try {
      const values = await connForm.validateFields();
      setConnTesting(true);
      setConnTestResult(null);
      // Backend POST /connections/test needs the full config; in edit mode if
      // password is blank we ask the server for the existing decrypted password.
      let password = values.password || '';
      let extraConfig = values.extra_config;
      if (typeof extraConfig === 'string') {
        try { extraConfig = JSON.parse(extraConfig || '{}'); } catch { extraConfig = {}; }
      }
      if (editingConn && !password) {
        try {
          const full = await connectionsApi.get(projectId, editingConn.id);
          password = full.password || '';
        } catch {
          // fall through with empty password
        }
      }
      const result = await connectionsApi.test({
        db_type: values.db_type,
        host: values.host,
        port: values.port,
        database_name: values.database_name,
        username: values.username,
        password,
        extra_config: extraConfig,
      });
      setConnTestResult(result);
    } catch (err: any) {
      if (err?.errorFields) return;
      setConnTestResult({ success: false, message: err.response?.data?.error || err.message || '测试失败', latency_ms: 0 });
    } finally {
      setConnTesting(false);
    }
  };

  const handleTestSaved = async (connId: number) => {
    setTesting(connId);
    try {
      const result = await connectionsApi.preview(connId);
      if (result.success) message.success(`连接成功！延迟 ${result.latency_ms}ms`);
      else message.error(`连接失败: ${result.message}`);
    } catch (err: any) {
      message.error('测试连接失败: ' + (err.response?.data?.error || err.message));
    }
    setTesting(null);
  };

  const handleSync = async (connId: number) => {
    setSyncing(connId);
    try {
      const result = await connectionsApi.sync(connId);
      message.success(`同步完成！版本 ${result.version_number}`);
      fetchConnections();
    } catch (err: any) {
      message.error('同步失败: ' + (err.response?.data?.error || err.message));
    }
    setSyncing(null);
  };

  const openConnModal = (record?: any) => {
    setEditingConn(record || null);
    if (record) {
      // Pre-fill, parse extra_config to object so Form can use nested names
      let extra: any = {};
      try { extra = record.extra_config ? JSON.parse(record.extra_config) : {}; } catch { extra = {}; }
      connForm.setFieldsValue({
        name: record.name,
        db_type: record.db_type,
        host: record.host,
        port: record.port,
        database_name: record.database_name,
        username: record.username === '***' ? '' : record.username,
        password: '',
        extra_config: extra,
      });
    } else {
      connForm.resetFields();
    }
    setConnTestResult(null);
    setConnModalOpen(true);
  };

  const handleSaveConnection = async () => {
    try {
      const values = await connForm.validateFields();
      // Serialize extra_config object back to JSON string for backend compatibility.
      const payload: any = {
        ...values,
        extra_config: typeof values.extra_config === 'object'
          ? JSON.stringify(values.extra_config || {})
          : (values.extra_config || '{}'),
      };
      if (editingConn) {
        await connectionsApi.update(projectId, editingConn.id, payload);
        message.success('连接已更新');
      } else {
        await connectionsApi.create(projectId, payload);
        message.success('连接已创建');
      }
      setConnModalOpen(false);
      setEditingConn(null);
      connForm.resetFields();
      fetchConnections();
    } catch (err: any) {
      if (err.errorFields) return;
      message.error(err.response?.data?.error || '保存失败');
    }
  };

  const handleDeleteConnection = async (connId: number) => {
    try {
      await connectionsApi.delete(projectId, connId);
      message.success('连接已删除');
      fetchConnections();
    } catch {
      message.error('删除失败');
    }
  };

  // ===== Members ============================================================

  const searchUsers = async (q: string) => {
    setUserSearchLoading(true);
    try {
      const data = await adminApi.searchUsers({ q, excludeProjectId: projectId });
      setUserOptions(data || []);
    } catch {
      // ignore
    }
    setUserSearchLoading(false);
  };

  const openMemberModal = () => {
    memberForm.resetFields();
    setUserOptions([]);
    searchUsers('');
    setMemberModalOpen(true);
  };

  const handleAddMember = async () => {
    try {
      const values = await memberForm.validateFields();
      const userIds: number[] = values.userIds || [];
      if (userIds.length === 0) {
        message.warning('请选择至少一个用户');
        return;
      }
      if (userIds.length === 1) {
        await projectsApi.addMember(projectId, { userId: userIds[0], roleName: values.roleName });
      } else {
        await projectsApi.addMembersBatch(projectId, { user_ids: userIds, roleName: values.roleName });
      }
      message.success('成员已添加');
      setMemberModalOpen(false);
      memberForm.resetFields();
      fetchProject();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err.response?.data?.error || '添加失败');
    }
  };

  const handleUpdateMemberRole = async (userId: number, roleName: string) => {
    try {
      await projectsApi.updateMember(projectId, userId, { roleName });
      message.success('角色已更新');
      fetchProject();
    } catch (err: any) {
      message.error(err.response?.data?.error || '更新失败');
    }
  };

  const handleRemoveMember = async (userId: number) => {
    try {
      await projectsApi.removeMember(projectId, userId);
      message.success('成员已移除');
      fetchProject();
    } catch {
      message.error('移除失败');
    }
  };

  // ===== Role bindings ======================================================

  const openBindRole = () => {
    setBindRoleModalOpen(true);
  };

  const handleAddRoleBinding = async (values: { roleId: number }) => {
    try {
      await projectsApi.addRoleBinding(projectId, { role_id: values.roleId });
      message.success('已绑定');
      setBindRoleModalOpen(false);
      fetchRoleBindings();
    } catch (err: any) {
      message.error(err.response?.data?.error || '绑定失败');
    }
  };

  const handleRemoveRoleBinding = async (bindingId: number) => {
    try {
      await projectsApi.removeRoleBinding(projectId, bindingId);
      message.success('已解绑');
      fetchRoleBindings();
    } catch {
      message.error('解绑失败');
    }
  };

  // ===== Settings ===========================================================

  const handleSaveSettings = async () => {
    try {
      const values = await settingsForm.validateFields();
      await projectsApi.update(projectId, values);
      message.success('项目设置已更新');
      fetchProject();
    } catch {
      message.error('保存失败');
    }
  };

  const handleDeleteProject = async () => {
    try {
      await projectsApi.delete(projectId);
      message.success('项目已删除');
      navigate('/dashboard');
    } catch {
      message.error('删除失败');
    }
  };

  // ===== Columns ============================================================

  const connectionColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: '类型', dataIndex: 'db_type', key: 'db_type',
      render: (type: string) => <Tag color={dbTypeColors[type] || 'default'}>{type.toUpperCase()}</Tag>,
    },
    { title: '地址', key: 'address', render: (_: any, r: any) => `${r.host}:${r.port}` },
    { title: '数据库', dataIndex: 'database_name', key: 'database_name' },
    {
      title: '最新版本', key: 'version',
      render: (_: any, r: any) => r.latest_version ? (
        <Tag color={r.latest_version.status === 'published' ? 'green' : 'orange'}>
          v{r.latest_version.version_number} ({r.latest_version.status === 'published' ? '已发布' : '草稿'})
        </Tag>
      ) : <Tag>未同步</Tag>,
    },
    {
      title: '操作', key: 'actions', width: 360,
      render: (_: any, record: any) => (
        <Space wrap>
          <Button
            size="small" icon={<ApiOutlined />} loading={testing === record.id}
            onClick={() => handleTestSaved(record.id)}
          >
            测试
          </Button>
          {canSync && (
            <Button
              size="small" icon={<SyncOutlined />} loading={syncing === record.id}
              onClick={() => handleSync(record.id)}
            >
              同步
            </Button>
          )}
          <Button
            size="small" type="primary" icon={<EyeOutlined />}
            onClick={() => navigate(`/connections/${record.id}/dictionary`)}
          >
            字典
          </Button>
          <Button
            size="small" icon={<EyeOutlined />}
            onClick={() => navigate(`/connections/${record.id}/versions`)}
          >
            版本
          </Button>
          {canManageConn && (
            <Button size="small" icon={<EditOutlined />} onClick={() => openConnModal(record)}>
              编辑
            </Button>
          )}
          {canManageConn && (
            <Popconfirm
              title="确定删除？"
              onConfirm={() => handleDeleteConnection(record.id)}
              okText="确定" cancelText="取消"
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const memberColumns = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '用户名称', dataIndex: 'display_name', key: 'display_name', render: (v: string) => v || '-' },
    {
      title: '项目角色', key: 'role',
      render: (_: any, record: any) => (
        <Select
          value={record.role_name || record.role || 'project-viewer'}
          style={{ width: 160 }}
          disabled={!canManageMembers || record.user_id === project?.created_by}
          onChange={(roleName) => handleUpdateMemberRole(record.user_id, roleName)}
          options={['project-admin', 'project-editor', 'project-viewer'].map((r) => ({
            value: r,
            label: ROLE_LABELS[r]?.name || r,
          }))}
        />
      ),
    },
    {
      title: '操作', key: 'action', width: 100,
      render: (_: any, record: any) =>
        record.user_id !== project?.created_by ? (
          canManageMembers ? (
            <Popconfirm
              title="确定移除？"
              onConfirm={() => handleRemoveMember(record.user_id)}
              okText="确定" cancelText="取消"
            >
              <Button size="small" danger>移除</Button>
            </Popconfirm>
          ) : <Text type="secondary">无权限</Text>
        ) : <Tag>创建者</Tag>,
    },
  ];

  const roleBindingColumns = [
    {
      title: '角色名', dataIndex: 'role_name', key: 'role_name',
      render: (v: string) => (
        <Space>
          <Tag color="geekblue">{v}</Tag>
          {ROLE_LABELS[v] && <Text type="secondary">{ROLE_LABELS[v].name}</Text>}
        </Space>
      ),
    },
    { title: '描述', dataIndex: 'role_description', key: 'role_description' },
    {
      title: '绑定时间', dataIndex: 'created_at', key: 'created_at',
      render: (v: string) => v?.split('T')[0] || '-',
    },
    {
      title: '操作', key: 'action', width: 100,
      render: (_: any, record: ProjectRoleBinding) => (
        canManageMembers ? (
          <Popconfirm
            title="确定解绑该角色？"
            onConfirm={() => handleRemoveRoleBinding(record.id)}
            okText="确定" cancelText="取消"
          >
            <Button size="small" danger>解绑</Button>
          </Popconfirm>
        ) : null
      ),
    },
  ];

  const tabItems = [
    {
      key: 'connections',
      label: <span><LinkOutlined />数据库连接</span>,
      children: (
        <>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">配置数据库连接，并从这里同步数据库结构</Text>
            {canManageConn && (
              <Button
                type="primary" icon={<PlusOutlined />}
                onClick={() => openConnModal()}
              >
                添加连接
              </Button>
            )}
          </div>
          <Table dataSource={connections} columns={connectionColumns} rowKey="id" pagination={false} />
        </>
      ),
    },
    {
      key: 'members',
      label: <span><TeamOutlined />成员管理</span>,
      children: (
        <>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">为项目添加成员或调整其角色</Text>
            {canManageMembers && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openMemberModal}>
                添加成员
              </Button>
            )}
          </div>
          <Table dataSource={project?.members || []} columns={memberColumns} rowKey="user_id" pagination={false} />
          {!canManageMembers && (
            <Alert
              type="info" showIcon style={{ marginTop: 16 }}
              message="您没有该项目的成员管理权限"
            />
          )}
        </>
      ),
    },
    {
      key: 'roleBindings',
      label: <span><SettingOutlined />项目角色</span>,
      children: (
        <>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">把角色绑定到本项目后，所有拥有该角色的用户将自动获得项目内权限</Text>
            {canManageMembers && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openBindRole}>
                绑定角色
              </Button>
            )}
          </div>
          <Table
            dataSource={roleBindings} columns={roleBindingColumns} rowKey="id"
            pagination={false} locale={{ emptyText: '暂未绑定任何角色' }}
          />
        </>
      ),
    },
    {
      key: 'settings',
      label: <span><SettingOutlined />项目设置</span>,
      children: (
        <div style={{ maxWidth: 600 }}>
          <Form form={settingsForm} layout="vertical" disabled={!canEditProject && !isSystemAdmin}>
            <Form.Item name="name" label="项目名称" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="description" label="项目描述">
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" onClick={handleSaveSettings} disabled={!canEditProject && !isSystemAdmin}>
                保存设置
              </Button>
            </Form.Item>
          </Form>
          {(canDeleteProject || isSystemAdmin) && (
            <Card style={{ marginTop: 24, borderColor: '#ff4d4f' }}>
              <Title level={5} type="danger">危险操作</Title>
              <Popconfirm
                title="确定要删除该项目？此操作不可恢复！"
                onConfirm={handleDeleteProject} okText="删除" cancelText="取消" okType="danger"
              >
                <Button danger>删除项目</Button>
              </Popconfirm>
            </Card>
          )}
        </div>
      ),
    },
  ];

  if (loading) return <Spin size="large" style={{ display: 'flex', justifyContent: 'center', padding: 100 }} />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>{project?.name}</Title>
        {project?.description && <Text type="secondary">{project.description}</Text>}
      </div>
      <Tabs items={tabItems} />

      {/* Connection Modal */}
      <Modal
        title={editingConn ? '编辑连接' : '添加连接'}
        open={connModalOpen}
        onOk={handleSaveConnection}
        onCancel={() => { setConnModalOpen(false); setEditingConn(null); connForm.resetFields(); setConnTestResult(null); }}
        width={640}
        okText="保存" cancelText="取消"
        footer={[
          <Button
            key="test" icon={<ThunderboltOutlined />} loading={connTesting}
            onClick={handleTestFromForm}
          >
            测试连接
          </Button>,
          <Button key="cancel" onClick={() => { setConnModalOpen(false); setEditingConn(null); connForm.resetFields(); setConnTestResult(null); }}>
            取消
          </Button>,
          <Button key="save" type="primary" onClick={handleSaveConnection}>
            保存
          </Button>,
        ]}
      >
        {connTestResult && (
          <Alert
            style={{ marginBottom: 16 }}
            type={connTestResult.success ? 'success' : 'error'}
            showIcon
            message={
              connTestResult.success
                ? `连接成功${connTestResult.latency_ms ? `，延迟 ${connTestResult.latency_ms}ms` : ''}`
                : `连接失败: ${connTestResult.message}`
            }
          />
        )}
        <Form form={connForm} layout="vertical">
          <Form.Item name="name" label="连接名称" rules={[{ required: true }]}>
            <Input placeholder="例如: 生产数据库" />
          </Form.Item>
          <Form.Item name="db_type" label="数据库类型" rules={[{ required: true }]}>
            <Select
              placeholder="选择数据库类型"
              onChange={(val) => connForm.setFieldValue('port', dbTypeDefaultPorts[val])}
              options={Object.keys(dbTypeDefaultPorts).map((k) => ({ value: k, label: k.toUpperCase() }))}
            />
          </Form.Item>
          <Space style={{ width: '100%' }} size={16}>
            <Form.Item name="host" label="主机" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="localhost" />
            </Form.Item>
            <Form.Item name="port" label="端口" rules={[{ required: true }]} style={{ width: 120 }}>
              <InputNumber placeholder="3306" style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="database_name" label="数据库名" rules={[{ required: true }]}>
            <Input placeholder="database_name" />
          </Form.Item>
          <Space style={{ width: '100%' }} size={16}>
            <Form.Item name="username" label="用户名" style={{ flex: 1 }} rules={[{ required: true }]}>
              <Input placeholder="username" />
            </Form.Item>
            <Form.Item name="password" label="密码" style={{ flex: 1 }} tooltip="留空则保留原密码">
              <Input.Password placeholder={editingConn ? '（留空不修改）' : 'password'} />
            </Form.Item>
          </Space>
          <Collapse ghost>
            <Panel header="高级配置" key="extra">
              <Form.Item name={['extra_config', 'schema']} label="Schema (PostgreSQL)">
                <Input placeholder="public" />
              </Form.Item>
              <Form.Item name={['extra_config', 'connectString']} label="Connect String (Oracle)">
                <Input placeholder="host:port/service_name" />
              </Form.Item>
              <Form.Item name={['extra_config', 'token']} label="Token (InfluxDB)">
                <Input.Password placeholder="API token" />
              </Form.Item>
              <Form.Item name={['extra_config', 'org']} label="Organization (InfluxDB)">
                <Input placeholder="org name" />
              </Form.Item>
            </Panel>
          </Collapse>
        </Form>
      </Modal>

      {/* Add Member Modal */}
      <Modal
        title="添加成员"
        open={memberModalOpen}
        onOk={handleAddMember}
        onCancel={() => { setMemberModalOpen(false); memberForm.resetFields(); }}
        okText="添加" cancelText="取消"
        width={520}
      >
        <Form form={memberForm} layout="vertical" initialValues={{ roleName: 'project-viewer' }}>
          <Form.Item name="userIds" label="用户（可多选）" rules={[{ required: true, message: '请选择至少一个用户' }]}>
            <Select
              mode="multiple"
              showSearch
              placeholder="输入用户名搜索..."
              defaultActiveFirstOption={false}
              filterOption={false}
              onSearch={searchUsers}
              loading={userSearchLoading}
              notFoundContent={userSearchLoading ? '搜索中...' : '暂无数据'}
              options={userOptions.map((u) => ({
                value: u.id,
                label: `${u.display_name || u.username}${u.email ? ` (${u.email})` : ''}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="roleName" label="授予的项目角色" rules={[{ required: true }]}>
            <Select
              options={['project-admin', 'project-editor', 'project-viewer'].map((r) => ({
                value: r,
                label: (
                  <Space>
                    <Tag color={ROLE_LABELS[r]?.color || 'default'}>{ROLE_LABELS[r]?.name || r}</Tag>
                  </Space>
                ),
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Add Role Binding Modal */}
      <Modal
        title="绑定角色到项目"
        open={bindRoleModalOpen}
        onCancel={() => setBindRoleModalOpen(false)}
        footer={null}
        width={520}
      >
        <Form layout="vertical" onFinish={handleAddRoleBinding}>
          <Form.Item
            name="roleId" label="选择角色" rules={[{ required: true }]}
            extra="绑定后，所有拥有该角色的用户将自动获得本项目的相应权限"
          >
            <Select
              placeholder="选择要绑定的角色"
              options={allRoles
                .filter((r) => !roleBindings.find((b) => b.role_id === r.id))
                .map((r) => ({ value: r.id, label: `${r.name}${r.is_system ? '（内置）' : ''}` }))}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">绑定</Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ProjectDetail;
