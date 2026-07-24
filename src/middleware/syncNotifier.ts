import { Request, Response, NextFunction } from 'express';
import { notifyBranchUpdate } from '../services/socket.service';

export const syncNotifier = (req: Request, res: Response, next: NextFunction) => {
  // Capture the original res.json and res.send
  const originalJson = res.json;
  
  res.json = function(body: any) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        // Try to find the branchId from the request
        const branchId = req.query.branchId || req.body?.branchId;
        
        if (branchId) {
          notifyBranchUpdate(branchId as string, 'data_mutated');
        } else {
          // If no specific branch, notify all connected clients
          notifyBranchUpdate('ALL', 'data_mutated');
        }
      }
    }
    return originalJson.call(this, body);
  };
  
  next();
};
