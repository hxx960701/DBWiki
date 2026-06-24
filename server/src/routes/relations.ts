import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import knex from '../database/connection.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import { getProjectPermissions } from '../services/permissions.js';
import { validate } from '../middleware/validate.js';

export const relationsRouter = Router();

relationsRouter.use(authenticate);

// ----- Helpers ---------------------------------------------------------------

async function ensureConnectionAccess(req: Request, connectionId: number, requiredPerm: string) {
  const connection = await knex('database_connections').where({ id: connectionId }).first();
  if (!connection) throw new AppError('Connection not found', 404);

  const userId = req.user!.userId;
  const isAdmin = req.user!.role === 'admin';
  if (!isAdmin) {
    const perms = await getProjectPermissions(userId, connection.project_id);
    if (!perms.includes(requiredPerm)) {
      throw new AppError('Insufficient permissions', 403);
    }
  }
  return connection;
}

async function ensureDimensionAccess(req: Request, dimensionId: number, requiredPerm: string) {
  const dimension = await knex('table_dimensions').where({ id: dimensionId }).first();
  if (!dimension) throw new AppError('Dimension not found', 404);
  await ensureConnectionAccess(req, dimension.connection_id, requiredPerm);
  return dimension;
}

async function ensureRelationAccess(req: Request, relationId: number, requiredPerm: string) {
  const relation = await knex('table_relations').where({ id: relationId }).first();
  if (!relation) throw new AppError('Relation not found', 404);
  await ensureDimensionAccess(req, relation.dimension_id, requiredPerm);
  return relation;
}

// ----- Dimensions -----------------------------------------------------------

// GET /relations/connections/:connectionId/dimensions
relationsRouter.get(
  '/connections/:connectionId/dimensions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectionId = parseInt(req.params.connectionId as string, 10);
      await ensureConnectionAccess(req, connectionId, 'dictionary:read');

      const dimensions = await knex('table_dimensions')
        .where({ connection_id: connectionId })
        .orderBy('name', 'asc');

      res.json(dimensions);
    } catch (error) {
      next(error);
    }
  },
);

// POST /relations/connections/:connectionId/dimensions
const createDimensionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
});

relationsRouter.post(
  '/connections/:connectionId/dimensions',
  validate(createDimensionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectionId = parseInt(req.params.connectionId as string, 10);
      await ensureConnectionAccess(req, connectionId, 'dictionary:edit');

      const { name, description } = req.body;

      const [id] = await knex('table_dimensions').insert({
        connection_id: connectionId,
        name,
        description: description || '',
      });

      const dimension = await knex('table_dimensions').where({ id }).first();
      res.json(dimension);
    } catch (error) {
      if ((error as any).code === 'ER_DUP_ENTRY') {
        next(new AppError('Dimension name already exists', 400));
      } else {
        next(error);
      }
    }
  },
);

// PUT /relations/dimensions/:id
const updateDimensionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
});

relationsRouter.put(
  '/dimensions/:id',
  validate(updateDimensionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dimensionId = parseInt(req.params.id as string, 10);
      await ensureDimensionAccess(req, dimensionId, 'dictionary:edit');

      const { name, description } = req.body;
      const updateData: any = { updated_at: knex.fn.now() };
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;

      await knex('table_dimensions').where({ id: dimensionId }).update(updateData);

      const dimension = await knex('table_dimensions').where({ id: dimensionId }).first();
      res.json(dimension);
    } catch (error) {
      if ((error as any).code === 'ER_DUP_ENTRY') {
        next(new AppError('Dimension name already exists', 400));
      } else {
        next(error);
      }
    }
  },
);

// DELETE /relations/dimensions/:id
relationsRouter.delete(
  '/dimensions/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dimensionId = parseInt(req.params.id as string, 10);
      await ensureDimensionAccess(req, dimensionId, 'dictionary:edit');

      await knex('table_dimensions').where({ id: dimensionId }).delete();
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

// ----- Relations ------------------------------------------------------------

// GET /relations/dimensions/:dimensionId/relations
relationsRouter.get(
  '/dimensions/:dimensionId/relations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dimensionId = parseInt(req.params.dimensionId as string, 10);
      await ensureDimensionAccess(req, dimensionId, 'dictionary:read');

      const relations = await knex('table_relations')
        .where({ dimension_id: dimensionId })
        .orderBy('created_at', 'asc');

      res.json(relations);
    } catch (error) {
      next(error);
    }
  },
);

// POST /relations/dimensions/:dimensionId/relations
const createRelationSchema = z.object({
  source_table_name: z.string().min(1).max(255),
  source_column_name: z.string().min(1).max(255),
  target_table_name: z.string().min(1).max(255),
  target_column_name: z.string().min(1).max(255),
  relation_type: z.enum(['1:1', '1:N', 'N:M']).optional(),
});

relationsRouter.post(
  '/dimensions/:dimensionId/relations',
  validate(createRelationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dimensionId = parseInt(req.params.dimensionId as string, 10);
      await ensureDimensionAccess(req, dimensionId, 'dictionary:edit');

      const { source_table_name, source_column_name, target_table_name, target_column_name, relation_type } = req.body;

      const [id] = await knex('table_relations').insert({
        dimension_id: dimensionId,
        source_table_name,
        source_column_name,
        target_table_name,
        target_column_name,
        relation_type: relation_type || '1:N',
      });

      const relation = await knex('table_relations').where({ id }).first();
      res.json(relation);
    } catch (error) {
      next(error);
    }
  },
);

// PUT /relations/relations/:id
const updateRelationSchema = z.object({
  relation_type: z.enum(['1:1', '1:N', 'N:M']).optional(),
});

relationsRouter.put(
  '/relations/:id',
  validate(updateRelationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const relationId = parseInt(req.params.id as string, 10);
      await ensureRelationAccess(req, relationId, 'dictionary:edit');

      const { relation_type } = req.body;
      if (relation_type !== undefined) {
        await knex('table_relations').where({ id: relationId }).update({ relation_type });
      }

      const relation = await knex('table_relations').where({ id: relationId }).first();
      res.json(relation);
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /relations/relations/:id
relationsRouter.delete(
  '/relations/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const relationId = parseInt(req.params.id as string, 10);
      await ensureRelationAccess(req, relationId, 'dictionary:edit');

      await knex('table_relations').where({ id: relationId }).delete();
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

// ----- Positions ------------------------------------------------------------

// GET /relations/dimensions/:dimensionId/positions
relationsRouter.get(
  '/dimensions/:dimensionId/positions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dimensionId = parseInt(req.params.dimensionId as string, 10);
      await ensureDimensionAccess(req, dimensionId, 'dictionary:read');

      const positions = await knex('table_positions')
        .where({ dimension_id: dimensionId })
        .orderBy('table_name', 'asc');

      res.json(positions);
    } catch (error) {
      next(error);
    }
  },
);

// PUT /relations/dimensions/:dimensionId/positions
const savePositionsSchema = z.object({
  positions: z.array(
    z.object({
      table_name: z.string().min(1).max(255),
      position_x: z.number().int(),
      position_y: z.number().int(),
    }),
  ),
});

relationsRouter.put(
  '/dimensions/:dimensionId/positions',
  validate(savePositionsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dimensionId = parseInt(req.params.dimensionId as string, 10);
      await ensureDimensionAccess(req, dimensionId, 'dictionary:edit');

      const { positions } = req.body;

      // Delete all existing positions for this dimension and insert new ones
      await knex('table_positions').where({ dimension_id: dimensionId }).delete();

      if (positions.length > 0) {
        const insertData = positions.map((p: { table_name: string; position_x: number; position_y: number }) => ({
          dimension_id: dimensionId,
          table_name: p.table_name,
          position_x: p.position_x,
          position_y: p.position_y,
        }));
        await knex('table_positions').insert(insertData);
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);
