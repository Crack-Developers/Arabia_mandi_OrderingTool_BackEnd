import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, notificationController.getAll);
router.patch('/:id/read', authMiddleware, notificationController.markRead);
router.delete('/:id', authMiddleware, notificationController.delete);

export default router;
