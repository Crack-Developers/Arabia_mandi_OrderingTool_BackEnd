import { Request, Response, NextFunction } from 'express';
import { notifyBranchUpdate, getIO } from '../services/socket.service';

export const syncNotifier = (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;

  res.json = function(body: any) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {

        // Detect branch update and emit sections payload directly for instant local pruning
        const isBranchUpdate = req.path.match(/^\/[a-f0-9]{24}$/) && req.method === 'PUT'
          && req.originalUrl?.includes('/branches/');

        if (isBranchUpdate && body?.data) {
          const updatedBranch = body.data;
          const branchId = updatedBranch._id?.toString();
          if (branchId) {
            try {
              const io = getIO();
              // Emit to ALL clients so every desktop picks up the deletion
              io.emit('branch_sections_updated', {
                branchId,
                sections: updatedBranch.sections || [],
              });
              console.log(`[Socket.io] Emitted branch_sections_updated for ${branchId} with ${(updatedBranch.sections||[]).length} sections`);
            } catch (_) {}
          }
        }

        // Also emit the generic cloud_update for other changes
        const branchId = req.query.branchId || req.body?.branchId;
        if (branchId) {
          notifyBranchUpdate(branchId as string, 'data_mutated');
        } else {
          notifyBranchUpdate('ALL', 'data_mutated');
        }
      }
    }
    return originalJson.call(this, body);
  };

  next();
};
