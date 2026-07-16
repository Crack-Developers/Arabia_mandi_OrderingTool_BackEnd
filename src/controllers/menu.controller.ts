import { Request, Response, NextFunction } from 'express';
import { menuService } from '../services/menu.service';

export const menuController = {
  // Categories
  async getAllCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const categories = await menuService.getAllCategories(req.query['branchId'] as string | undefined);
      res.json({ success: true, data: categories });
    } catch (err) { next(err); }
  },
  async createCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const cat = await menuService.createCategory(req.body);
      res.status(201).json({ success: true, message: 'Category created.', data: cat });
    } catch (err) { next(err); }
  },
  async updateCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const cat = await menuService.updateCategory(req.params['id'] as string, req.body);
      res.json({ success: true, message: 'Category updated.', data: cat });
    } catch (err) { next(err); }
  },
  async deleteCategory(req: Request, res: Response, next: NextFunction) {
    try {
      await menuService.deleteCategory(req.params['id'] as string);
      res.json({ success: true, message: 'Category deleted.' });
    } catch (err) { next(err); }
  },

  // Menu Items
  async getAllMenuItems(req: Request, res: Response, next: NextFunction) {
    try {
      const items = await menuService.getAllMenuItems(
        req.query['branchId'] as string | undefined,
        req.query['categoryId'] as string | undefined,
      );
      res.json({ success: true, data: items });
    } catch (err) { next(err); }
  },
  async getMenuItemById(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await menuService.getMenuItemById(req.params['id'] as string);
      res.json({ success: true, data: item });
    } catch (err) { next(err); }
  },
  async createMenuItem(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await menuService.createMenuItem(req.body);
      res.status(201).json({ success: true, message: 'Menu item created.', data: item });
    } catch (err) { next(err); }
  },
  async updateMenuItem(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await menuService.updateMenuItem(req.params['id'] as string, req.body);
      res.json({ success: true, message: 'Menu item updated.', data: item });
    } catch (err) { next(err); }
  },
  async deleteMenuItem(req: Request, res: Response, next: NextFunction) {
    try {
      await menuService.deleteMenuItem(req.params['id'] as string);
      res.json({ success: true, message: 'Menu item deleted.' });
    } catch (err) { next(err); }
  },
  async toggleAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await menuService.toggleAvailability(req.params['id'] as string);
      res.json({ success: true, message: 'Availability toggled.', data: item });
    } catch (err) { next(err); }
  },
};
