import { Request, Response, NextFunction } from 'express';
import { branchService } from '../services/branch.service';

export const branchController = {
  async getAll(_req: Request, res: Response, next: NextFunction) {
    try {
      const branches = await branchService.getAll();
      res.json({ success: true, data: branches });
    } catch (err) { next(err); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const branch = await branchService.getById(req.params['id'] as string);
      res.json({ success: true, data: branch });
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const branch = await branchService.create(req.body);
      res.status(201).json({ success: true, message: 'Branch created.', data: branch });
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const branch = await branchService.update(req.params['id'] as string, req.body);
      res.json({ success: true, message: 'Branch updated.', data: branch });
    } catch (err) { next(err); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await branchService.delete(req.params['id'] as string);
      res.json({ success: true, message: 'Branch deleted.' });
    } catch (err) { next(err); }
  },

  async toggleStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const branch = await branchService.toggleStatus(req.params['id'] as string);
      res.json({ success: true, message: 'Branch status toggled.', data: branch });
    } catch (err) { next(err); }
  },
};
