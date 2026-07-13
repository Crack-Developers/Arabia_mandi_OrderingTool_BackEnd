import { Request, Response, NextFunction } from 'express';
import { sectionService } from '../services/section.service';

export const sectionController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const sections = await sectionService.getAll(req.query['branchId'] as string | undefined);
      res.json({ success: true, data: sections });
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const section = await sectionService.create(req.body);
      res.status(201).json({ success: true, message: 'Section created.', data: section });
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const section = await sectionService.update(req.params['id'] as string, req.body);
      res.json({ success: true, message: 'Section updated.', data: section });
    } catch (err) { next(err); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await sectionService.delete(req.params['id'] as string);
      res.json({ success: true, message: 'Section deleted.' });
    } catch (err) { next(err); }
  },
};
