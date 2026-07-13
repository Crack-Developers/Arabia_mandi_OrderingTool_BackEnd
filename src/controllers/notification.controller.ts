import { Request, Response, NextFunction } from 'express';
import { notificationService } from '../services/notification.service';

export const notificationController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const notifs = await notificationService.getAll(req.query['branchId'] as string | undefined);
      res.json({ success: true, data: notifs });
    } catch (err) { next(err); }
  },

  async markRead(req: Request, res: Response, next: NextFunction) {
    try {
      const notif = await notificationService.markRead(req.params['id'] as string);
      res.json({ success: true, data: notif });
    } catch (err) { next(err); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await notificationService.delete(req.params['id'] as string);
      res.json({ success: true, message: 'Notification deleted.' });
    } catch (err) { next(err); }
  },
};
