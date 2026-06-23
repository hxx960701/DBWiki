import React, { useEffect, useState } from 'react';
import {
  Card, Tabs, Descriptions, Table, Tag, Button, Form, Input, Spin,
  message, Space, Popconfirm, Typography, Result, Alert,
} from 'antd';
import {
  DatabaseOutlined, TeamOutlined, LinkOutlined, TableOutlined,
  ApiOutlined, CheckCircleOutlined, CloseCircleOutlined, CloudUploadOutlined,
} from '@ant-design/icons';
import { systemApi } from '../../api/system';

const { Text, Title } = Typography;

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
      key: 'dbconfig',
      label: '数据库配置',
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
