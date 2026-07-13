import { Request, Response, NextFunction } from 'express';
import { tableService } from '../services/table.service';

export const tableController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const tables = await tableService.getAll(req.query['branchId'] as string | undefined);
      res.json({ success: true, data: tables });
    } catch (err) { next(err); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const table = await tableService.getById(req.params['id'] as string);
      res.json({ success: true, data: table });
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const table = await tableService.create(req.body);
      res.status(201).json({ success: true, message: 'Table created.', data: table });
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const table = await tableService.update(req.params['id'] as string, req.body);
      res.json({ success: true, message: 'Table updated.', data: table });
    } catch (err) { next(err); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await tableService.delete(req.params['id'] as string);
      res.json({ success: true, message: 'Table deleted.' });
    } catch (err) { next(err); }
  },

  async reserve(req: Request, res: Response, next: NextFunction) {
    try {
      const { tableId, customerName, phone, guests } = req.body;
      const table = await tableService.reserve(tableId, customerName, phone, guests);
      res.json({ success: true, message: 'Table reserved.', data: table });
    } catch (err) { next(err); }
  },

  async cancelReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const table = await tableService.cancelReservation(req.body.tableId);
      res.json({ success: true, message: 'Reservation cancelled.', data: table });
    } catch (err) { next(err); }
  },

  async merge(req: Request, res: Response, next: NextFunction) {
    try {
      const { primaryTableId, targetTableId } = req.body;
      const result = await tableService.merge(primaryTableId, targetTableId);
      res.json({ success: true, message: 'Tables merged.', data: result });
    } catch (err) { next(err); }
  },

  async separate(req: Request, res: Response, next: NextFunction) {
    try {
      const table = await tableService.separate(req.body.tableId);
      res.json({ success: true, message: 'Tables separated.', data: table });
    } catch (err) { next(err); }
  },

  async release(req: Request, res: Response, next: NextFunction) {
    try {
      const table = await tableService.release(req.body.tableId);
      res.json({ success: true, message: 'Table released.', data: table });
    } catch (err) { next(err); }
  },
};
