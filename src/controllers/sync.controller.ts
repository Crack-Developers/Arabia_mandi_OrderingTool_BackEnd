import { Request, Response, NextFunction } from 'express';
import { syncService } from '../services/sync.service';

export const syncController = {
  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      const results = await syncService.upload(req.body.items || []);
      res.json({ success: true, message: 'Sync items uploaded.', data: results });
    } catch (err) { next(err); }
  },

  async getStatus(_req: Request, res: Response, next: NextFunction) {
    try {
      const status = await syncService.getStatus();
      res.json({ success: true, data: status });
    } catch (err) { next(err); }
  },

  async markSynced(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await syncService.markSynced(req.body.ids || []);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  },
};
