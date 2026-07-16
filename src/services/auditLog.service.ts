import mongoose from 'mongoose';
import AuditLog, { AuditActionType, IAuditLog } from '../models/AuditLog';
import Branch from '../models/Branch';
import { branchDbService } from './branchDb.service';

export interface LogActionPayload {
  branchId: string;
  branchCode?: string;
  actionType: AuditActionType;
  performedBy?: {
    staffId?: string;
    staffName?: string;
    role?: string;
  };
  target?: {
    entityType: 'ORDER' | 'TABLE' | 'BILL' | 'KOT' | 'SESSION' | 'MENU';
    entityId?: string;
    label?: string;
  };
  details?: Record<string, any>;
}

export const auditLogService = {
  /**
   * Log any structured action performed by Receptionist / POS Staff.
   * Writes both to master DB and dedicated branch local database.
   */
  async logAction(payload: LogActionPayload): Promise<IAuditLog | null> {
    try {
      let branchCode = payload.branchCode;
      if (!branchCode && payload.branchId) {
        const br = await Branch.findById(payload.branchId);
        branchCode = br?.branchCode || payload.branchId;
      }

      const logDoc = new AuditLog({
        branchId: payload.branchId || 'BR-MAIN',
        branchCode: branchCode || 'BR-MAIN',
        actionType: payload.actionType,
        performedBy: {
          staffId: payload.performedBy?.staffId || '',
          staffName: payload.performedBy?.staffName || 'Receptionist',
          role: payload.performedBy?.role || 'Receptionist',
        },
        target: payload.target,
        details: payload.details || {},
        synced: false,
        timestamp: new Date(),
      });

      await logDoc.save();

      // Also record inside dedicated branch local database if possible
      try {
        if (branchCode) {
          const dbName = branchDbService.getBranchDbName(branchCode);
          const uri = `mongodb://localhost:27017/${dbName}`;
          const branchConn = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 2000 }).asPromise();
          const BranchAuditModel = branchConn.model('AuditLog', AuditLog.schema);
          await BranchAuditModel.create(logDoc.toObject());
          await branchConn.close();
        }
      } catch {
        // Dedicated branch insert error fallback - master DB still holds authoritative record
      }

      return logDoc;
    } catch (err: any) {
      console.error('[AuditLog] Failed to record structured action log:', err.message);
      return null;
    }
  },

  async getLogs(branchId?: string, limit: number = 100) {
    const filter = branchId ? { branchId } : {};
    return AuditLog.find(filter).sort({ timestamp: -1 }).limit(limit);
  },

  async getUnsyncedLogs() {
    return AuditLog.find({ synced: false }).limit(200);
  },

  async markSynced(logIds: string[]) {
    return AuditLog.updateMany({ _id: { $in: logIds } }, { synced: true });
  },
};
