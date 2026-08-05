import { Router } from 'express';
import { syncController } from '../controllers/sync.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/upload', authMiddleware, syncController.upload);
router.get('/status', authMiddleware, syncController.getStatus);
router.post('/mark-synced', authMiddleware, syncController.markSynced);
router.get('/diagnose', authMiddleware, syncController.diagnose);
router.post('/replay', authMiddleware, syncController.replay);

export default router;
