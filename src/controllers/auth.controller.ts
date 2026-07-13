import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { AuthRequest } from '../middleware/auth';

export const authController = {
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ success: false, message: 'Username and password required.' });
        return;
      }
      const result = await authService.login(username, password);
      res.json({ success: true, message: 'Login successful.', data: result });
    } catch (err) { next(err); }
  },

  async getProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await authService.getProfile(req.user._id);
      res.json({ success: true, data: user });
    } catch (err) { next(err); }
  },

  async changePassword(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { currentPassword, newPassword } = req.body;
      const result = await authService.changePassword(req.user._id, currentPassword, newPassword);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  },
};
