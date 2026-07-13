import { Router } from 'express';
import { printerController } from '../controllers/printer.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All printer routes are protected by JWT auth
router.get('/scan',   authMiddleware, printerController.scanLAN);   // MUST be before /:id
router.post('/print', authMiddleware, printerController.printJob);

router.get('/',       authMiddleware, printerController.getAll);
router.get('/:id',    authMiddleware, printerController.getById);
router.post('/',      authMiddleware, printerController.create);
router.put('/:id',    authMiddleware, printerController.update);
router.delete('/:id', authMiddleware, printerController.delete);

export default router;
