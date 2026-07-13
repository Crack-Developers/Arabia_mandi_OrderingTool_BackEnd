import { Router } from 'express';
import { syncController } from '../controllers/sync.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/upload', authMiddleware, syncController.upload);
router.get('/status', authMiddleware, syncController.getStatus);
router.post('/mark-synced', authMiddleware, syncController.markSynced);

export default router;
