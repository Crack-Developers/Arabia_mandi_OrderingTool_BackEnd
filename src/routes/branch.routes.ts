import { Router } from 'express';
import { branchController } from '../controllers/branch.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, branchController.getAll);
router.get('/:id', authMiddleware, branchController.getById);
router.post('/', authMiddleware, branchController.create);
router.put('/:id', authMiddleware, branchController.update);
router.delete('/:id', authMiddleware, branchController.delete);
router.patch('/:id/toggle-status', authMiddleware, branchController.toggleStatus);

export default router;
