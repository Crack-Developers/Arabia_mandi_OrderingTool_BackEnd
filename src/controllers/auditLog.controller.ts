import { Request, Response, NextFunction } from 'express';
import { auditLogService } from '../services/auditLog.service';

export const auditLogController = {
  async getLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const branchId = req.query['branchId'] as string | undefined;
      const limit = Number(req.query['limit']) || 100;
      const logs = await auditLogService.getLogs(branchId, limit);
      res.json({ success: true, data: logs });
    } catch (err) {
      next(err);
    }
  },
};
