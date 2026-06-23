import React, { useEffect, useState } from 'react';
import {
  Table, Tag, Select, Button, Modal, Input, Form, message, Space, Popconfirm, Typography,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { adminApi } from '../../api/admin';
import { rolesApi } from '../../api/roles';
import { useAuthStore } from '../../stores/authStore';
import type { Role } from '../../types';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: string;
  project_count?: number;
  created_at: string;
  roles?: Array<{ role_id: number; role_name: string }>;
}

const AdminUsers: React.FC = () => {
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [resetModal, setResetModal] = useState<{ open: boolean; userId: number | null }>({ open: false, userId: null });
  const [newPassword, setNewPassword] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [editRolesUser, setEditRolesUser] = useState<UserRow | null>(null);
  const [editRolesValue, setEditRolesValue] = useState<number[]>([]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await adminApi.listUsers({ page, search: search || undefined });
      setUsers(data.data || []);
      setTotal(data.pagination?.total || 0);
    } catch {
      message.error('加载用户列表失败');
    }
    setLoading(false);
  };

  const fetchRoles = async () => {
    try {
      const data = await rolesApi.list();
      setRoles(data || []);
    } catch {
      // role:manage may be disabled — silently degrade.
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [page, search]);

  useEffect(() => {
    fetchRoles();
  }, []);

  const handleRoleChange = async (userId: number, role: string) => {
    try {
      await adminApi.updateRole(userId, role);
      message.success('角色已更新');
      fetchUsers();
    } catch (err: any) {
      message.error(err.response?.data?.error || '更新失败');
    }
  };

  const handleDelete = async (userId: number) => {
    try {
      await adminApi.deleteUser(userId);
      message.success('用户已删除');
      fetchUsers();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const handleResetPassword = async () => {
    if (!resetModal.userId || !newPassword) return;
    try {
      await adminApi.resetPassword(resetModal.userId, newPassword);
      message.success('密码已重置');
      setResetModal({ open: false, userId: null });
      setNewPassword('');
    } catch (err: any) {
      message.error(err.response?.data?.error || '重置失败');
    }
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      await adminApi.createUser({
        username: values.username,
        display_name: values.display_name || '',
        password: values.password,
        role: values.role,
        role_ids: values.role_ids || [],
      });
      message.success('用户已创建');
      setCreateOpen(false);
      createForm.resetFields();
      fetchUsers();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err.response?.data?.error || '创建失败');
    }
  };

  const openEditRoles = (record: UserRow) => {
    setEditRolesUser(record);
    setEditRolesValue((record.roles || []).map((r) => r.role_id));
  };

  const saveEditRoles = async () => {
    if (!editRolesUser) return;
    try {
      await adminApi.setRoles(editRolesUser.id, { role_ids: editRolesValue });
      message.success('角色已更新');
      setEditRolesUser(null);
      fetchUsers();
    } catch (err: any) {
      message.error(err.response?.data?.error || '更新失败');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '用户名称', dataIndex: 'display_name', key: 'display_name', render: (v: string) => v || '-' },
    {
      title: '类型',
      key: 'role',
      width: 130,
      render: (_: any, record: UserRow) => (
        <Select
          value={record.role}
          style={{ width: 110 }}
          disabled={record.id === currentUser?.id}
          onChange={(role) => handleRoleChange(record.id, role)}
          options={[
            { value: 'admin', label: '管理员' },
            { value: 'editor', label: '编辑者' },
            { value: 'viewer', label: '查看者' },
          ]}
        />
      ),
    },
    {
      title: '角色',
      key: 'roles',
      render: (_: any, record: UserRow) => (
        <Space size={4} wrap>
          {(record.roles || []).map((r) => (
            <Tag key={r.role_id} color="geekblue">
              {r.role_name}
            </Tag>
          ))}
          <Button size="small" type="link" onClick={() => openEditRoles(record)}>
            管理
          </Button>
        </Space>
      ),
    },
    {
      title: '项目数',
      dataIndex: 'project_count',
      key: 'projects',
      render: (v: number) => v || 0,
      width: 80,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
      width: 160,
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: any, record: UserRow) =>
        record.id !== currentUser?.id ? (
          <Space>
            <Button size="small" onClick={() => setResetModal({ open: true, userId: record.id })}>
              重置密码
            </Button>
            <Popconfirm
              title="确定删除该用户？"
              onConfirm={() => handleDelete(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button size="small" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          <Tag>当前用户</Tag>
        ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            用户管理
          </Title>
          <Text type="secondary">管理系统用户、分配角色与重置密码</Text>
        </div>
        <Space>
          <Input.Search
            placeholder="搜索用户名 / 用户名称..."
            allowClear
            onSearch={(v) => {
              setSearch(v);
              setPage(1);
            }}
            style={{ width: 280 }}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchUsers}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新增用户
          </Button>
        </Space>
      </div>

      <Table
        dataSource={users}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: setPage,
          showTotal: (t) => `共 ${t} 个用户`,
        }}
      />

      {/* Reset password */}
      <Modal
        title="重置密码"
        open={resetModal.open}
        onOk={handleResetPassword}
        onCancel={() => {
          setResetModal({ open: false, userId: null });
          setNewPassword('');
        }}
        okText="重置"
        cancelText="取消"
      >
        <Input.Password
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="输入新密码（至少6位）"
        />
      </Modal>

      {/* Create user */}
      <Modal
        title="新增用户"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        okText="创建"
        cancelText="取消"
        width={520}
      >
        <Form form={createForm} layout="vertical" initialValues={{ role: 'viewer' }}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }, { min: 3 }]}
          >
            <Input placeholder="3 位以上的用户名" />
          </Form.Item>
          <Form.Item
            name="display_name"
            label="用户名称"
            rules={[{ required: true, message: '请输入用户名称' }]}
          >
            <Input placeholder="显示名称（如：张三）" />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[{ required: true, message: '请输入初始密码' }, { min: 6 }]}
          >
            <Input.Password placeholder="至少 6 位" />
          </Form.Item>
          <Form.Item name="role" label="账号类型">
            <Select
              options={[
                { value: 'admin', label: '管理员' },
                { value: 'editor', label: '编辑者' },
                { value: 'viewer', label: '查看者' },
              ]}
            />
          </Form.Item>
          <Form.Item name="role_ids" label="附加角色（可选）">
            <Select
              mode="multiple"
              placeholder="选择要绑定的角色"
              options={roles.map((r) => ({ value: r.id, label: r.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit roles */}
      <Modal
        title={editRolesUser ? `管理角色 — ${editRolesUser.username}` : '管理角色'}
        open={!!editRolesUser}
        onOk={saveEditRoles}
        onCancel={() => setEditRolesUser(null)}
        okText="保存"
        cancelText="取消"
      >
        <Select
          mode="multiple"
          value={editRolesValue}
          onChange={setEditRolesValue}
          placeholder="为该用户分配角色"
          style={{ width: '100%' }}
          options={roles.map((r) => ({
            value: r.id,
            label: (
              <span>
                {r.name}
                {r.is_system && <Tag style={{ marginLeft: 6 }}>内置</Tag>}
              </span>
            ),
          }))}
        />
      </Modal>
    </div>
  );
};

export default AdminUsers;
