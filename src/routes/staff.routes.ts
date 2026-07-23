import { Router } from 'express';
import { staffController } from '../controllers/staff.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, staffController.getAll);
router.get('/:id/qr-payload', authMiddleware, staffController.getQRPayload);
router.get('/:id', authMiddleware, staffController.getById);
router.post('/', authMiddleware, staffController.create);
router.put('/:id', authMiddleware, staffController.update);
router.delete('/:id', authMiddleware, staffController.delete);
router.post('/:id/reset-password', authMiddleware, staffController.resetPassword);

export default router;
