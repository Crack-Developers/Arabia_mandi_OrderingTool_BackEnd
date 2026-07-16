import { Request, Response, NextFunction } from 'express';
import { printerService } from '../services/printer.service';
import { printJobService } from '../services/printJob.service';
import { AuthRequest } from '../middleware/auth';

export const printerController = {

  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const branchId = (req.query.branchId as string) || (req as AuthRequest).user?.branchId;
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
      const branchId = req.body.branchId || (req as AuthRequest).user?.branchId;
      const printer = await printerService.create({ ...req.body, branchId });
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
      const branchId = (req.query.branchId as string) || (req as AuthRequest).user?.branchId;
      await printerService.delete(req.params['id'] as string, branchId);
      res.json({ success: true, message: 'Printer removed.' });
    } catch (err) { next(err); }
  },

  /** GET /api/v1/printers/scan  – discover printers on the same LAN subnet */
  async scanLAN(req: Request, res: Response, next: NextFunction) {
    try {
      const branchId = (req.query.branchId as string) || (req as AuthRequest).user?.branchId;
      const result = await printerService.scanLAN(branchId);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  },

  /** POST /api/v1/printers/ping  – verify TCP reachability of a LAN printer IP:port */
  async pingLAN(req: Request, res: Response, next: NextFunction) {
    try {
      const { ip, port = 9100 } = req.body;
      if (!ip) {
        res.status(400).json({ success: false, message: 'ip is required.' });
        return;
      }
      const result = await printerService.pingLAN(ip, Number(port));
      res.json(result);
    } catch (err) { next(err); }
  },

  /** POST /api/v1/printers/dispatch-kot  – intelligently split and dispatch KOT items to their assigned LAN printers */
  async dispatchKOT(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const kotPayload = {
        ...req.body,
        branchId: req.body?.branchId || req.user?.branchId,
      };
      if (!kotPayload || !kotPayload.items) {
        res.status(400).json({ success: false, message: 'kotPayload with items array is required.' });
        return;
      }
      const outcome = await printerService.dispatchKOT(kotPayload);
      res.json({ success: true, message: `KOT queued for ${outcome.dispatched} printer(s).`, outcome });
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

  async getCounterConfigs(req: Request, res: Response, next: NextFunction) {
    try {
      const configs = await printerService.getCounterConfigs(req.query.branchId as string | undefined);
      res.json({ success: true, data: configs });
    } catch (err) { next(err); }
  },

  async createCounterConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const config = await printerService.createCounterConfig(req.body);
      res.status(201).json({ success: true, message: 'Counter configuration created.', data: config });
    } catch (err) { next(err); }
  },

  async updateCounterConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const config = await printerService.updateCounterConfig(req.params['id'] as string, req.body);
      res.json({ success: true, message: 'Counter configuration updated.', data: config });
    } catch (err) { next(err); }
  },

  async deleteCounterConfig(req: Request, res: Response, next: NextFunction) {
    try {
      await printerService.deleteCounterConfig(req.params['id'] as string);
      res.json({ success: true, message: 'Counter configuration removed.' });
    } catch (err) { next(err); }
  },

  async getJobs(req: Request, res: Response, next: NextFunction) {
    try {
      const jobs = await printJobService.getJobs({
        status: req.query.status as string | undefined,
        branchId: req.query.branchId as string | undefined,
        printerId: req.query.printerId as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ success: true, data: jobs });
    } catch (err) { next(err); }
  },

  async claimNextJob(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = String(req.body.agentId || req.query.agentId || '');
      if (!agentId) {
        res.status(400).json({ success: false, message: 'agentId is required.' });
        return;
      }
      const job = await printJobService.claimNextPendingJob(agentId, req.body.branchId || (req.query.branchId as string | undefined));
      res.json({ success: true, data: job });
    } catch (err) { next(err); }
  },

  async completeJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { agentId, message } = req.body;
      const job = await printJobService.completeJob(req.params['id'] as string, agentId, message);
      res.json({ success: true, message: 'Print job marked complete.', data: job });
    } catch (err) { next(err); }
  },

  async failJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { agentId, error } = req.body;
      const job = await printJobService.failJob(req.params['id'] as string, agentId, error || 'Unknown print failure');
      res.json({ success: true, message: 'Print job failure recorded.', data: job });
    } catch (err) { next(err); }
  },

  async queueTestJob(req: Request, res: Response, next: NextFunction) {
    try {
      const job = await printJobService.queueTestJob(req.body.printerId, req.body.branchId);
      res.status(201).json({ success: true, message: 'Printer test job queued.', data: job });
    } catch (err) { next(err); }
  },
};
