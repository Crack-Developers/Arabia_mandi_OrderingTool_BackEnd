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
      // withPrint=true → save KOT + dispatch to kitchen printer
      // withPrint=false → save KOT only (no printer dispatch)
      const withPrint: boolean = req.body.withPrint !== false; // default true
      const result = await orderService.generateKOT(
        req.params['id'] as string,
        req.user?.name || 'System',
        withPrint,
      );

      if (withPrint) {
        // Queue printer jobs; a local printer agent will claim and execute them.
        try {
          const { printerService } = await import('../services/printer.service');
          await printerService.dispatchKOT({
            ...result.kot,
            orderId: result.order._id,
            tableId: result.order.tableId,
            tableNumber: (result.order as any).tableNumber || '',
            branchName: (result.order as any).branchName || '',
            orderNumber: result.order.orderNumber,
          });
        } catch {
          // Printer dispatch failure is non-fatal — KOT is already saved in DB
        }
      }

      res.json({
        success: true,
        message: withPrint ? 'KOT generated and queued for kitchen printers.' : 'KOT saved (no print).',
        data: result,
      });
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
      let receiptJob: any = null;
      try {
        const { printJobService } = await import('../services/printJob.service');
        receiptJob = await printJobService.queueReceiptJob(req.body.billId, {
          counterName: req.body.counterName,
          counterConfigId: req.body.counterConfigId,
        });
      } catch (queueErr) {
        // Payment stays successful even if receipt routing is not configured yet.
      }
      res.json({ success: true, message: 'Payment processed.', data: { ...result, receiptJob } });
    } catch (err) { next(err); }
  },

  async syncLocalOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const order = await orderService.syncLocalOrder(req.body);
      res.json({ success: true, message: 'Order synced.', data: order });
    } catch (err) { next(err); }
  },
};
