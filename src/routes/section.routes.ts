import { Router } from 'express';
import { sectionController } from '../controllers/section.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, sectionController.getAll);
router.post('/', authMiddleware, sectionController.create);
router.put('/:id', authMiddleware, sectionController.update);
router.delete('/:id', authMiddleware, sectionController.delete);

export default router;
