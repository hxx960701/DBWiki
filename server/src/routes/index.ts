import { Router } from 'express';
import { authRouter } from './auth.js';
import { projectsRouter } from './projects.js';
import { connectionActionsRouter } from './connections.js';
import { dictionaryRouter } from './dictionary.js';
import { versionsRouter } from './versions.js';
import { adminRouter } from './admin.js';
import { systemRouter } from './system.js';
import { rolesRouter, permissionsRouter } from './roles.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/projects', projectsRouter);
apiRouter.use('/connections', connectionActionsRouter);
apiRouter.use('/dictionary', dictionaryRouter);
apiRouter.use('/dictionary/versions', versionsRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/admin/system', systemRouter);
apiRouter.use('/roles', rolesRouter);
apiRouter.use('/permissions', permissionsRouter);
