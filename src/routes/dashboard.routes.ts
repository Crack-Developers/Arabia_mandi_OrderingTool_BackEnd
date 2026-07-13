import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/admin', authMiddleware, dashboardController.getAdminStats);

export default router;
