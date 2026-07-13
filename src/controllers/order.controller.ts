import { Request, Response, NextFunction } from 'express';
import { orderService } from '../services/order.service';
import { AuthRequest } from '../middleware/auth';

export const orderController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const orders = await orderService.getAll(
        req.query['branchId'] as string | undefined,
        req.query['status'] as string | undefined
      );
      res.json({ success: true, data: orders });
    } catch (err) { next(err); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const order = await orderService.getById(req.params['id'] as string);
      res.json({ success: true, data: order });
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const order = await orderService.create(req.body);
      res.status(201).json({ success: true, message: 'Order created.', data: order });
    } catch (err) { next(err); }
  },

  async addItems(req: Request, res: Response, next: NextFunction) {
    try {
      const order = await orderService.addItems(req.params['id'] as string, req.body.items);
      res.json({ success: true, message: 'Items added.', data: order });
    } catch (err) { next(err); }
  },

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const order = await orderService.updateStatus(req.params['id'] as string, req.body.status);
      res.json({ success: true, message: 'Order status updated.', data: order });
    } catch (err) { next(err); }
  },

  async generateKOT(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await orderService.generateKOT(req.params['id'] as string, req.user?.name || 'System');
      res.json({ success: true, message: 'KOT generated.', data: result });
    } catch (err) { next(err); }
  },

  async generateBill(req: Request, res: Response, next: NextFunction) {
    try {
      const bill = await orderService.generateBill(req.params['id'] as string, req.body.branchId);
      res.json({ success: true, message: 'Bill generated.', data: bill });
    } catch (err) { next(err); }
  },

  async processPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await orderService.processPayment(req.body.billId, req.body.paymentMethods);
      res.json({ success: true, message: 'Payment processed.', data: result });
    } catch (err) { next(err); }
  },
};
