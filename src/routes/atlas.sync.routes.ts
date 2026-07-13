import { Router } from 'express';
import { atlasSyncController } from '../controllers/atlas.sync.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/status', authMiddleware, atlasSyncController.status);
router.post('/force',  authMiddleware, atlasSyncController.forceSync);

export default router;
