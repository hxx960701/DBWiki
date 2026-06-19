import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Button, Input, Modal, Form, message, Popconfirm, Tag, Spin, Empty } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, DatabaseOutlined, TeamOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../../stores/projectStore';
import { projectsApi } from '../../api/projects';
import dayjs from 'dayjs';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { projects, loading, fetchProjects } = useProjectStore();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    fetchProjects({ search: search || undefined });
  }, [search]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      if (editingProject) {
        await projectsApi.update(editingProject.id, values);
        message.success('项目已更新');
      } else {
        await projectsApi.create(values);
        message.success('项目已创建');
      }
      setModalOpen(false);
      setEditingProject(null);
      form.resetFields();
      fetchProjects({ search: search || undefined });
    } catch (err: any) {
      if (err.errorFields) return;
      message.error('操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await projectsApi.delete(id);
      message.success('项目已删除');
      fetchProjects({ search: search || undefined });
    } catch {
      message.error('删除失败');
    }
  };

  const openEdit = (e: React.MouseEvent, project: any) => {
    e.stopPropagation();
    setEditingProject(project);
    form.setFieldsValue({ name: project.name, description: project.description });
    setModalOpen(true);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>项目总览</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingProject(null); form.resetFields(); setModalOpen(true); }}>
          新建项目
        </Button>
      </div>

      <Input.Search
        placeholder="搜索项目..."
        allowClear
        onSearch={setSearch}
        style={{ marginBottom: 24, maxWidth: 400 }}
      />

      <Spin spinning={loading}>
        {projects.length === 0 && !loading ? (
          <Empty description="暂无项目，点击「新建项目」开始" />
        ) : (
          <Row gutter={[16, 16]}>
            {projects.map(project => (
              <Col xs={24} sm={12} lg={8} xl={6} key={project.id}>
                <Card
                  hoverable
                  onClick={() => navigate(`/projects/${project.id}`)}
                  actions={[
                    <EditOutlined key="edit" onClick={(e) => openEdit(e, project)} />,
                    <Popconfirm title="确定删除该项目？" onConfirm={() => handleDelete(project.id)} okText="确定" cancelText="取消">
                      <DeleteOutlined key="delete" onClick={(e) => e.stopPropagation()} />
                    </Popconfirm>,
                  ]}
                >
                  <Card.Meta
                    title={project.name}
                    description={project.description || '暂无描述'}
                  />
                  <div style={{ marginTop: 16 }}>
                    <Tag icon={<TeamOutlined />} color="blue">{project.member_count || 0} 成员</Tag>
                    <Tag icon={<DatabaseOutlined />} color="green">{project.connection_count || 0} 连接</Tag>
                  </div>
                  <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
                    {project.creator_name && <span>创建者: {project.creator_name}</span>}
                    <span style={{ marginLeft: 8 }}>{dayjs(project.created_at).format('YYYY-MM-DD')}</span>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Spin>

      <Modal
        title={editingProject ? '编辑项目' : '新建项目'}
        open={modalOpen}
        onOk={handleCreate}
        onCancel={() => { setModalOpen(false); setEditingProject(null); form.resetFields(); }}
        okText="确定"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="输入项目名称" />
          </Form.Item>
          <Form.Item name="description" label="项目描述">
            <Input.TextArea placeholder="输入项目描述（可选）" rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Dashboard;
