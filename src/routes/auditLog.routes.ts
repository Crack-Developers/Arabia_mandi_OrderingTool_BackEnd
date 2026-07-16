import { Router } from 'express';
import { auditLogController } from '../controllers/auditLog.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, auditLogController.getLogs);

export default router;
