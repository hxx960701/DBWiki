import React, { useEffect, useMemo, useState } from 'react';
import {
  Layout, List, Card, Typography, Button, Modal, Form, Input, Tag, Space, Checkbox,
  message, Popconfirm, Empty, Table,
} from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { rolesApi, permissionsApi } from '../../api/roles';
import type { Role, Permission } from '../../types';

const { Sider, Content } = Layout;
const { Title, Text } = Typography;

const RoleManagement: React.FC = () => {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [members, setMembers] = useState<Array<{ id: number; username: string; email: string }>>([]);
  const [editingPermissions, setEditingPermissions] = useState<string[]>([]);
  const [editingDescription, setEditingDescription] = useState<string>('');

  const selected = useMemo(() => roles.find((r) => r.id === selectedId) || null, [roles, selectedId]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [rs, ps] = await Promise.all([rolesApi.list(), permissionsApi.list()]);
      setRoles(rs);
      setPermissions(ps);
      if (rs.length && selectedId === null) setSelectedId(rs[0].id);
    } catch {
      message.error('加载角色信息失败');
    }
    setLoading(false);
  };

  const fetchMembers = async (roleId: number) => {
    try {
      const m = await rolesApi.listUsers(roleId);
      setMembers(m);
    } catch {
      setMembers([]);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    if (selected) {
      setEditingPermissions(selected.permission_codes || []);
      setEditingDescription(selected.description || '');
      fetchMembers(selected.id);
    }
  }, [selectedId]);

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const created = await rolesApi.create({
        name: values.name,
        description: values.description || '',
        permission_codes: [],
      });
      message.success('角色已创建');
      setCreateOpen(false);
      createForm.resetFields();
      await fetchAll();
      setSelectedId(created.id);
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err.response?.data?.error || '创建失败');
    }
  };

  const handleDelete = async (role: Role) => {
    try {
      await rolesApi.delete(role.id);
      message.success('角色已删除');
      const next = roles.filter((r) => r.id !== role.id);
      setRoles(next);
      setSelectedId(next.length ? next[0].id : null);
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const handleSave = async () => {
    if (!selected) return;
    try {
      await rolesApi.update(selected.id, {
        description: editingDescription,
        permission_codes: editingPermissions,
      });
      message.success('已保存');
      fetchAll();
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存失败');
    }
  };

  // Group permissions by scope for display.
  const grouped = useMemo(() => {
    const out: Record<string, Permission[]> = { global: [], project: [] };
    for (const p of permissions) {
      if (p.scope === 'global') out.global.push(p);
      else out.project.push(p);
    }
    return out;
  }, [permissions]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>角色管理</Title>
          <Text type="secondary">定义角色，给角色分配权限位，再把角色分配给用户或绑定到项目。</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新增角色
        </Button>
      </div>

      <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 280px)' }}>
        <Sider width={260} style={{ background: '#fff', borderRight: '1px solid #f0f0f0' }}>
          <List
            size="small"
            loading={loading}
            dataSource={roles}
            renderItem={(role) => (
              <List.Item
                onClick={() => setSelectedId(role.id)}
                style={{
                  cursor: 'pointer',
                  padding: '10px 16px',
                  background: role.id === selectedId ? '#e6f4ff' : undefined,
                  borderLeft: role.id === selectedId ? '3px solid #1677ff' : '3px solid transparent',
                }}
              >
                <div style={{ width: '100%' }}>
                  <Space>
                    <Text strong={role.id === selectedId}>{role.name}</Text>
                    {role.is_system && <Tag color="default">内置</Tag>}
                  </Space>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{role.description}</div>
                </div>
              </List.Item>
            )}
          />
        </Sider>
        <Content style={{ padding: '0 24px' }}>
          {selected ? (
            <Card
              title={
                <Space>
                  {selected.name}
                  {selected.is_system && <Tag>内置</Tag>}
                </Space>
              }
              extra={
                <Space>
                  <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
                    保存
                  </Button>
                  {!selected.is_system && (
                    <Popconfirm title="确定删除？" onConfirm={() => handleDelete(selected)}>
                      <Button danger icon={<DeleteOutlined />}>
                        删除角色
                      </Button>
                    </Popconfirm>
                  )}
                </Space>
              }
            >
              <Form layout="vertical">
                <Form.Item label="描述">
                  <Input
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                    placeholder="角色用途说明"
                  />
                </Form.Item>
              </Form>

              <Title level={5} style={{ marginTop: 16 }}>权限分配</Title>
              <Card size="small" title="全局权限" style={{ marginBottom: 16 }}>
                <Checkbox.Group
                  value={editingPermissions}
                  onChange={(vals) => setEditingPermissions(vals as string[])}
                  options={grouped.global.map((p) => ({
                    value: p.code,
                    label: (
                      <span>
                        <code style={{ background: '#f5f5f5', padding: '0 4px' }}>{p.code}</code>{' '}
                        {p.name}
                      </span>
                    ),
                  }))}
                />
              </Card>
              <Card size="small" title="项目权限">
                <Checkbox.Group
                  value={editingPermissions}
                  onChange={(vals) => setEditingPermissions(vals as string[])}
                  options={grouped.project.map((p) => ({
                    value: p.code,
                    label: (
                      <span>
                        <code style={{ background: '#f5f5f5', padding: '0 4px' }}>{p.code}</code>{' '}
                        {p.name}
                      </span>
                    ),
                  }))}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
                />
              </Card>

              <Title level={5} style={{ marginTop: 24 }}>绑定该角色的用户</Title>
              <Table
                size="small"
                dataSource={members}
                rowKey="id"
                pagination={false}
                columns={[
                  { title: '用户名', dataIndex: 'username' },
                  { title: '邮箱', dataIndex: 'email' },
                ]}
              />
            </Card>
          ) : (
            <Empty description="请从左侧选择一个角色" />
          )}
        </Content>
      </Layout>

      <Modal
        title="新增角色"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        okText="创建"
        cancelText="取消"
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="角色名" rules={[{ required: true, message: '请输入角色名' }]}>
            <Input placeholder="如 analyst / qa" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="角色用途说明" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default RoleManagement;
