import React, { useState, useEffect } from 'react';
import { Layout, Menu, Dropdown, Space, theme, Breadcrumb, Avatar, Tag, Typography } from 'antd';
import {
  AppstoreOutlined,
  TeamOutlined,
  SafetyOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  DatabaseOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Outlet, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useHeartbeat } from '../../hooks/useHeartbeat';
import { connectionsApi } from '../../api/connections';
import { projectsApi } from '../../api/projects';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const MainLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const { user, logout, hasPermission } = useAuthStore();
  const { token: { colorBgContainer, borderRadiusLG } } = theme.useToken();

  // Drive the admin "online now" badge from real user activity in this tab.
  useHeartbeat(Boolean(user));

  // Breadcrumb info loaded async for connection/project pages
  const [connectionInfo, setConnectionInfo] = useState<{ connection_name: string; project_name: string } | null>(null);
  const [projectName, setProjectName] = useState<string>('');

  useEffect(() => {
    const segs = location.pathname.split('/').filter(Boolean);

    // Connection pages
    if (segs[0] === 'connections' && segs[1]) {
      const id = parseInt(segs[1], 10);
      if (!isNaN(id)) {
        connectionsApi.getInfo(id).then(setConnectionInfo).catch(() => setConnectionInfo(null));
      }
      return () => setConnectionInfo(null);
    }
    setConnectionInfo(null);

    // Project pages
    if (segs[0] === 'projects' && segs[1]) {
      const id = parseInt(segs[1], 10);
      if (!isNaN(id)) {
        projectsApi.get(id).then((p) => setProjectName(p.name || '')).catch(() => setProjectName(''));
      }
      return () => setProjectName('');
    }
    setProjectName('');
  }, [location.pathname]);

  // Build menu groups: workspace + admin (admin only shows when permitted).
  const adminChildren: NonNullable<MenuProps['items']> = [];
  if (hasPermission('user:manage')) {
    adminChildren.push({ key: '/admin/users', icon: <TeamOutlined />, label: '用户管理' });
  }
  if (hasPermission('role:manage')) {
    adminChildren.push({ key: '/admin/roles', icon: <SafetyOutlined />, label: '角色管理' });
  }
  if (hasPermission('user:manage')) {
    adminChildren.push({ key: '/admin/system', icon: <ToolOutlined />, label: '系统管理' });
  }
  const menuItems: MenuProps['items'] = [
    {
      type: 'group',
      label: collapsed ? '' : '工作区',
      children: [
        { key: '/dashboard', icon: <AppstoreOutlined />, label: '项目总览' },
      ],
    },
  ];
  if (adminChildren.length > 0) {
    menuItems.push({
      type: 'group',
      label: collapsed ? '' : '系统管理',
      children: adminChildren,
    });
  }

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key);
  };

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: (
        <span>
          {user?.username} <Tag color={user?.role === 'admin' ? 'red' : 'blue'} style={{ marginLeft: 4 }}>{user?.role}</Tag>
        </span>
      ),
    },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ];

  const handleUserMenu = ({ key }: { key: string }) => {
    if (key === 'logout') {
      logout();
      navigate('/login');
    } else if (key === 'profile') {
      navigate('/profile');
    }
  };

  // The selected menu key is the top-level path segment.
  const selectedKey = '/' + location.pathname.split('/').filter(Boolean)[0];

  // Build breadcrumb based on path segments. Best-effort labels.
  const segments = location.pathname.split('/').filter(Boolean);
  const breadcrumbItems = (() => {
    const items: Array<{ title: React.ReactNode; href?: string }> = [
      { title: '首页', href: '/dashboard' },
    ];
    if (segments[0] === 'dashboard') items[0] = { title: '项目总览' };
    else if (segments[0] === 'projects') {
      items.push({ title: '项目总览', href: '/dashboard' });
      items.push({ title: projectName || `项目 #${params.id || segments[1]}` });
    } else if (segments[0] === 'connections') {
      items.push({ title: '项目总览', href: '/dashboard' });
      if (segments[2] === 'dictionary') {
        if (connectionInfo) {
          items.push({ title: connectionInfo.project_name || '项目' });
          items.push({ title: connectionInfo.connection_name });
        } else {
          items.push({ title: '数据字典' });
        }
      } else if (segments[2] === 'versions') items.push({ title: '版本历史' });
    } else if (segments[0] === 'admin') {
      if (segments[1] === 'users') items.push({ title: '用户管理' });
      else if (segments[1] === 'roles') items.push({ title: '角色管理' });
      else if (segments[1] === 'system') items.push({ title: '系统管理' });
    } else if (segments[0] === 'profile') {
      items.push({ title: '个人设置' });
    }
    return items;
  })();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        theme="light"
        style={{
          boxShadow: '2px 0 8px rgba(0,0,0,0.04)',
          borderRight: '1px solid #f0f0f0',
        }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            fontSize: collapsed ? 16 : 20,
            color: '#1677ff',
            borderBottom: '1px solid #f0f0f0',
            gap: 8,
          }}
        >
          <DatabaseOutlined />
          {!collapsed && <span>DBwiki</span>}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={handleMenuClick}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: '0 24px',
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 4px rgba(0,21,41,0.05)',
          }}
        >
          <Space size={16}>
            <span
              style={{ cursor: 'pointer', fontSize: 18, color: '#666' }}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </span>
            <Breadcrumb
              items={breadcrumbItems.map((b) =>
                b.href
                  ? { title: <a onClick={() => navigate(b.href!)}>{b.title}</a> }
                  : { title: b.title },
              )}
            />
          </Space>
          <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenu }} placement="bottomRight">
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" style={{ backgroundColor: '#1677ff' }} icon={<UserOutlined />} />
              <Text>{user?.username}</Text>
            </Space>
          </Dropdown>
        </Header>
        <Content
          style={{
            margin: 24,
            padding: 24,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
            minHeight: 280,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
