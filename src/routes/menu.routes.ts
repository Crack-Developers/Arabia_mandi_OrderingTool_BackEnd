import { Router } from 'express';
import { menuController } from '../controllers/menu.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Categories
router.get('/categories', authMiddleware, menuController.getAllCategories);
router.post('/categories', authMiddleware, menuController.createCategory);
router.put('/categories/:id', authMiddleware, menuController.updateCategory);
router.delete('/categories/:id', authMiddleware, menuController.deleteCategory);

// Menu Items
router.get('/items', authMiddleware, menuController.getAllMenuItems);
router.get('/items/:id', authMiddleware, menuController.getMenuItemById);
router.post('/items', authMiddleware, menuController.createMenuItem);
router.put('/items/:id', authMiddleware, menuController.updateMenuItem);
router.delete('/items/:id', authMiddleware, menuController.deleteMenuItem);
router.patch('/items/:id/availability', authMiddleware, menuController.toggleAvailability);

export default router;
