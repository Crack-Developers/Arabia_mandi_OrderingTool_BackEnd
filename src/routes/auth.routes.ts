import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/login', authController.login);
router.get('/profile', authMiddleware, authController.getProfile);
router.put('/change-password', authMiddleware, authController.changePassword);

export default router;
