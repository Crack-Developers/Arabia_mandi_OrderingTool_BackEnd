import { Request, Response, NextFunction } from 'express';
import { printerService } from '../services/printer.service';

export const printerController = {

  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { branchId } = req.query;
      const printers = await printerService.getAll(branchId as string | undefined);
      res.json({ success: true, printers });
    } catch (err) { next(err); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const printer = await printerService.getById(req.params['id'] as string);
      res.json({ success: true, data: printer });
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const printer = await printerService.create(req.body);
      res.status(201).json({ success: true, message: 'Printer registered.', printer });
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const printer = await printerService.update(req.params['id'] as string, req.body);
      res.json({ success: true, message: 'Printer updated.', printer });
    } catch (err) { next(err); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await printerService.delete(req.params['id'] as string);
      res.json({ success: true, message: 'Printer removed.' });
    } catch (err) { next(err); }
  },

  /** GET /api/v1/printers/scan  – discover printers on the same LAN subnet */
  async scanLAN(_req: Request, res: Response, next: NextFunction) {
    try {
      const printers = await printerService.scanLAN();
      res.json({ success: true, printers });
    } catch (err) { next(err); }
  },

  /** POST /api/v1/printers/print  – dispatch a print job to a registered printer */
  async printJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { printerId, payload } = req.body;
      if (!printerId || !payload) {
        res.status(400).json({ success: false, message: 'printerId and payload are required.' });
        return;
      }
      await printerService.printJob(printerId, payload);
      res.json({ success: true, message: 'Print job dispatched.' });
    } catch (err) { next(err); }
  },
};
