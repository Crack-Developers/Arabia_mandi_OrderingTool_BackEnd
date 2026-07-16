import { Router } from 'express';
import { orderController } from '../controllers/order.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, orderController.getAll);
router.get('/:id', authMiddleware, orderController.getById);
router.post('/', authMiddleware, orderController.create);
router.post('/:id/add-items', authMiddleware, orderController.addItems);
router.patch('/:id/status', authMiddleware, orderController.updateStatus);
router.post('/:id/kot', authMiddleware, orderController.generateKOT);
router.post('/:id/bill', authMiddleware, orderController.generateBill);
router.post('/payment', authMiddleware, orderController.processPayment);
router.post('/sync-local', authMiddleware, orderController.syncLocalOrder);

export default router;
