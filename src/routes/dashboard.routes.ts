import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Legacy simple stats
router.get('/admin', authMiddleware, dashboardController.getAdminStats);

// Full dashboard analytics — date + branchId query params
router.get('/stats', authMiddleware, dashboardController.getDashboardStats);

// Dish summary analytics — filterType, date/month/year, category, branchId
router.get('/dish-summary', authMiddleware, dashboardController.getDishSummary);

// Leakage logs
router.get('/leakage-logs', authMiddleware, dashboardController.getLeakageLogs);

export default router;
