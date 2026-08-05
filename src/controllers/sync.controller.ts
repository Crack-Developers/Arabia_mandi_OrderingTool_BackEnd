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

  /** GET /api/v1/sync/diagnose — Analyze pending (failed-to-apply) sync queue items */
  async diagnose(_req: Request, res: Response, next: NextFunction) {
    try {
      const result = await syncService.diagnose();
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  /** POST /api/v1/sync/replay — Re-attempt applying all pending sync queue items */
  async replay(req: Request, res: Response, next: NextFunction) {
    try {
      const batchSize = parseInt(req.query.batchSize as string) || 100;
      const result = await syncService.replay(batchSize);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },
};
