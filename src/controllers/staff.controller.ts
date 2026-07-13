import { Request, Response, NextFunction } from 'express';
import { staffService } from '../services/staff.service';

export const staffController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const staff = await staffService.getAll(req.query['branchId'] as string | undefined);
      res.json({ success: true, data: staff });
    } catch (err) { next(err); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const staff = await staffService.getById(req.params['id'] as string);
      res.json({ success: true, data: staff });
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const staff = await staffService.create(req.body);
      res.status(201).json({ success: true, message: 'Staff created.', data: staff });
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const staff = await staffService.update(req.params['id'] as string, req.body);
      res.json({ success: true, message: 'Staff updated.', data: staff });
    } catch (err) { next(err); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await staffService.delete(req.params['id'] as string);
      res.json({ success: true, message: 'Staff removed.' });
    } catch (err) { next(err); }
  },

  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await staffService.resetPassword(req.params['id'] as string);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },
};
