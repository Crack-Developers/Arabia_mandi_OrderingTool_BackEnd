import { Request, Response, NextFunction } from 'express';
import { forceSyncNow } from '../services/atlas.sync.service';
import Order  from '../models/Order';
import Bill   from '../models/Bill';

export const atlasSyncController = {

  /** GET /api/v1/atlas-sync/status – how many records are pending sync */
  async status(_req: Request, res: Response, next: NextFunction) {
    try {
      const [pendingOrders, pendingBills] = await Promise.all([
        Order.countDocuments({ synced: false }),
        Bill.countDocuments({ synced: false }),
      ]);

      const atlasConfigured = !!process.env.ATLAS_MONGO_URI;

      res.json({
        success: true,
        atlasConfigured,
        pending: { orders: pendingOrders, bills: pendingBills },
        totalPending: pendingOrders + pendingBills,
        message: atlasConfigured
          ? 'Atlas sync is active. Syncs automatically every 30 seconds when online.'
          : 'ATLAS_MONGO_URI not set. Add it to .env to enable cloud backup.',
      });
    } catch (err) { next(err); }
  },

  /** POST /api/v1/atlas-sync/force – trigger an immediate sync */
  async forceSync(_req: Request, res: Response, next: NextFunction) {
    try {
      const result = await forceSyncNow();
      res.json({ success: result.synced, message: result.message });
    } catch (err) { next(err); }
  },
};
