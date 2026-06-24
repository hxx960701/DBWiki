import React, { useState, useCallback } from 'react';
import { Select, Button, Space, Modal, Form, Input, Typography, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { relationsApi, type Dimension } from '../../api/relations';

const { Text } = Typography;

interface DimensionSelectorProps {
  connectionId: number;
  selectedDimension: Dimension | null;
  onDimensionChange: (dimension: Dimension | null) => void;
  dimensions: Dimension[];
  onDimensionsUpdate: () => void;
  canEdit: boolean;
}

const DimensionSelector: React.FC<DimensionSelectorProps> = ({
  connectionId,
  selectedDimension,
  onDimensionChange,
  dimensions,
  onDimensionsUpdate,
  canEdit,
}) => {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const handleCreate = async () => {
    try {
      const { name, description } = await createForm.validateFields();
      setCreateLoading(true);
      await relationsApi.createDimension(connectionId, { name, description });
      message.success('维度已创建');
      setCreateModalOpen(false);
      createForm.resetFields();
      onDimensionsUpdate();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error('创建失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedDimension) return;
    try {
      const { name, description } = await editForm.validateFields();
      setEditLoading(true);
      await relationsApi.updateDimension(selectedDimension.id, { name, description });
      message.success('维度已更新');
      setEditModalOpen(false);
      editForm.resetFields();
      onDimensionsUpdate();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error('更新失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = () => {
    if (!selectedDimension) return;
    Modal.confirm({
      title: '删除维度',
      content: `确定删除维度「${selectedDimension.name}」吗？该维度下的所有关联和布局都将被删除。`,
      okText: '删除',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await relationsApi.deleteDimension(selectedDimension.id);
          message.success('维度已删除');
          onDimensionChange(null);
          onDimensionsUpdate();
        } catch (err: any) {
          message.error('删除失败: ' + (err.response?.data?.error || err.message));
        }
      },
    });
  };

  return (
    <>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
        <Text strong style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>
          维度
        </Text>
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Select
            value={selectedDimension?.id}
            onChange={(val) => {
              const dim = dimensions.find((d) => d.id === val) || null;
              onDimensionChange(dim);
            }}
            style={{ width: '100%' }}
            placeholder="选择维度"
            options={dimensions.map((d) => ({ value: d.id, label: d.name }))}
            allowClear
          />
          {canEdit && (
            <Space>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
                新建
              </Button>
              {selectedDimension && (
                <>
                  <Button size="small" icon={<EditOutlined />} onClick={() => {
                    editForm.setFieldsValue({
                      name: selectedDimension.name,
                      description: selectedDimension.description,
                    });
                    setEditModalOpen(true);
                  }}>
                    编辑
                  </Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={handleDelete}>
                    删除
                  </Button>
                </>
              )}
            </Space>
          )}
        </Space>
      </div>

      <Modal
        title="新建维度"
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        onOk={handleCreate}
        okText="创建"
        cancelText="取消"
        confirmLoading={createLoading}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="维度名称" rules={[{ required: true, message: '请输入维度名称' }]}>
            <Input placeholder="如：工作中心、设备" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑维度"
        open={editModalOpen}
        onCancel={() => { setEditModalOpen(false); editForm.resetFields(); }}
        onOk={handleEdit}
        okText="保存"
        cancelText="取消"
        confirmLoading={editLoading}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="name" label="维度名称" rules={[{ required: true, message: '请输入维度名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default DimensionSelector;
