import React, { useState } from 'react';
import { Card, Form, Input, Button, message, Typography } from 'antd';
import { UserOutlined, LockOutlined, DatabaseOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

const { Text } = Typography;

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [loginLoading, setLoginLoading] = useState(false);

  const handleLogin = async (values: { username: string; password: string }) => {
    setLoginLoading(true);
    try {
      await login(values.username, values.password);
      message.success('登录成功');
      navigate('/dashboard');
    } catch (err: any) {
      message.error(err.response?.data?.error || '登录失败');
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #e0f2ff 0%, #f5f7fb 100%)',
      }}
    >
      <Card style={{ width: 420, boxShadow: '0 8px 32px rgba(22, 119, 255, 0.12)', borderRadius: 12 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 56,
              height: 56,
              borderRadius: 14,
              background: '#1677ff',
              color: '#fff',
              fontSize: 28,
              marginBottom: 12,
            }}
          >
            <DatabaseOutlined />
          </div>
          <h1 style={{ fontSize: 26, color: '#1677ff', margin: 0 }}>DBwiki</h1>
          <p style={{ color: '#888', margin: '4px 0 0' }}>数据字典管理系统</p>
        </div>
        <Form onFinish={handleLogin} size="large" layout="vertical">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" autoFocus />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 8 }}>
            <Button type="primary" htmlType="submit" loading={loginLoading} block>
              登录
            </Button>
          </Form.Item>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              如需开通账号，请联系管理员
            </Text>
          </div>
        </Form>
      </Card>
    </div>
  );
};

export default Login;
