import React, { useState } from 'react';
import { Card, Form, Input, Button, message, Typography, Divider, Alert } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../stores/authStore';

const { Title, Text } = Typography;

const Profile: React.FC = () => {
  const { user, mustChangePassword, clearMustChangePassword } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const handlePasswordChange = async (values: { currentPassword: string; newPassword: string }) => {
    setLoading(true);
    try {
      await authApi.changePassword(values);
      message.success('密码修改成功');
      clearMustChangePassword();
      form.resetFields();
    } catch (err: any) {
      message.error(err.response?.data?.error || '密码修改失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <Card>
        {mustChangePassword && (
          <Alert
            message="首次登录提示"
            description="您是首次登录或尚未修改过密码，请先修改密码后再继续使用系统。"
            type="warning"
            showIcon
            style={{ marginBottom: 24 }}
          />
        )}
        <div style={{ marginBottom: 24 }}>
          <Title level={4} style={{ marginBottom: 8 }}>
            <UserOutlined style={{ marginRight: 8 }} />
            个人信息
          </Title>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <Text type="secondary">用户名</Text>
              <div style={{ fontSize: 16, fontWeight: 500 }}>{user?.username}</div>
            </div>
            <div>
              <Text type="secondary">用户名称</Text>
              <div style={{ fontSize: 16, fontWeight: 500 }}>{user?.display_name || user?.username}</div>
            </div>
            <div>
              <Text type="secondary">角色</Text>
              <div style={{ fontSize: 16, fontWeight: 500 }}>{user?.role}</div>
            </div>
          </div>
        </div>

        <Divider style={{ margin: '16px 0' }} />

        <div>
          <Title level={4} style={{ marginBottom: 16 }}>
            <LockOutlined style={{ marginRight: 8 }} />
            修改密码
          </Title>
          <Form form={form} onFinish={handlePasswordChange} layout="vertical" size="large">
            <Form.Item
              name="currentPassword"
              label="当前密码"
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请输入当前密码" />
            </Form.Item>
            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 6, message: '新密码至少6个字符' },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请输入新密码（至少6个字符）" />
            </Form.Item>
            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请确认新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请再次输入新密码" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
              <Button type="primary" htmlType="submit" loading={loading} block>
                修改密码
              </Button>
            </Form.Item>
          </Form>
        </div>
      </Card>
    </div>
  );
};

export default Profile;