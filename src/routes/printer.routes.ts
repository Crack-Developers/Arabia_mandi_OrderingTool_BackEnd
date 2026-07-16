import { Router } from 'express';
import { printerController } from '../controllers/printer.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All printer routes are protected by JWT auth
router.get('/scan',        authMiddleware, printerController.scanLAN);   // MUST be before /:id
router.post('/ping',       authMiddleware, printerController.pingLAN);   // verify LAN IP reachability
router.get('/jobs', authMiddleware, printerController.getJobs);
router.post('/jobs/claim', printerController.claimNextJob);
router.post('/jobs/:id/complete', printerController.completeJob);
router.post('/jobs/:id/fail', printerController.failJob);
router.post('/jobs/test', authMiddleware, printerController.queueTestJob);
router.get('/counters', authMiddleware, printerController.getCounterConfigs);
router.post('/counters', authMiddleware, printerController.createCounterConfig);
router.put('/counters/:id', authMiddleware, printerController.updateCounterConfig);
router.delete('/counters/:id', authMiddleware, printerController.deleteCounterConfig);
router.post('/dispatch-kot', authMiddleware, printerController.dispatchKOT);
router.post('/print', authMiddleware, printerController.printJob);

router.get('/',       authMiddleware, printerController.getAll);
router.get('/:id',    authMiddleware, printerController.getById);
router.post('/',      authMiddleware, printerController.create);
router.put('/:id',    authMiddleware, printerController.update);
router.delete('/:id', authMiddleware, printerController.delete);

export default router;
