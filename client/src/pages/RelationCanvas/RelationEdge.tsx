import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { Tag } from 'antd';

export interface RelationEdgeData {
  relationType: '1:1' | '1:N' | 'N:M';
  [key: string]: any;
}

const RelationEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
}) => {
  const edgeData = data as RelationEdgeData;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={{ strokeWidth: selected ? 3 : 2 }} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          <Tag color={selected ? 'blue' : 'default'} style={{ fontSize: 11 }}>
            {edgeData.relationType}
          </Tag>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

export default RelationEdge;
