import { Router } from 'express';
import { tableController } from '../controllers/table.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, tableController.getAll);
router.get('/:id', authMiddleware, tableController.getById);
router.post('/', authMiddleware, tableController.create);
router.put('/:id', authMiddleware, tableController.update);
router.delete('/:id', authMiddleware, tableController.delete);
router.post('/reserve', authMiddleware, tableController.reserve);
router.post('/cancel-reservation', authMiddleware, tableController.cancelReservation);
router.post('/merge', authMiddleware, tableController.merge);
router.post('/separate', authMiddleware, tableController.separate);
router.post('/release', authMiddleware, tableController.release);

export default router;
