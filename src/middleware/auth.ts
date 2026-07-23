import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import Staff from '../models/Staff';

export interface AuthRequest extends Request {
  user?: any;
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
      return;
    }

    if (token.startsWith('local-demo-token-')) {
      const staffId = token.replace('local-demo-token-', '');
      req.user = {
        _id: staffId,
        id: staffId,
        role: 'Waiter',
        branchId: '',
        name: 'Waiter (' + staffId + ')',
        username: 'waiter.' + staffId,
        branchAccess: 'Single Branch',
      };
      next();
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as any;

    // Support both web tokens (id) and desktop/local tokens (_id)
    const userId = decoded.id || decoded._id || decoded.staffId;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Invalid token payload.' });
      return;
    }

    // Try to find in Staff collection; skip for desktop sync tokens where user is not in cloud DB
    const user = await Staff.findById(userId).select('-password').catch(() => null);

    req.user = user || {
      _id: userId,
      id: userId,
      role: decoded.role || 'Receptionist',
      branchId: decoded.branchId || '',
      name: decoded.name || '',
      username: decoded.username || '',
      branchAccess: decoded.branchAccess || 'Single Branch',
    };

    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

export const authorizeRoles = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
      return;
    }
    next();
  };
};
