import mongoose, { Schema, Document } from 'mongoose';

export type AuditActionType =
  | 'LOGIN_FIRST_TIME'
  | 'LOGIN_SUCCESS'
  | 'ORDER_CREATED'
  | 'ORDER_UPDATED'
  | 'ITEM_ADDED'
  | 'ITEM_REMOVED'
  | 'ORDER_CANCELLED'
  | 'KOT_GENERATED'
  | 'BILL_GENERATED'
  | 'PAYMENT_PROCESSED'
  | 'TABLE_STATUS_CHANGED'
  | 'TABLE_RESERVED'
  | 'TABLE_MERGED'
  | 'SYNC_TO_CLOUD';

export interface IAuditLog extends Document {
  branchId: string;
  branchCode: string;
  actionType: AuditActionType;
  performedBy: {
    staffId?: string;
    staffName: string;
    role: string;
  };
  target?: {
    entityType: 'ORDER' | 'TABLE' | 'BILL' | 'KOT' | 'SESSION' | 'MENU';
    entityId?: string;
    label?: string;
  };
  details: Record<string, any>;
  synced: boolean;
  timestamp: Date;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    branchId: { type: String, required: true, index: true },
    branchCode: { type: String, required: true, index: true },
    actionType: { type: String, required: true, index: true },
    performedBy: {
      staffId: String,
      staffName: { type: String, default: 'POS Staff' },
      role: { type: String, default: 'Receptionist' },
    },
    target: {
      entityType: String,
      entityId: String,
      label: String,
    },
    details: { type: Schema.Types.Mixed, default: {} },
    synced: { type: Boolean, default: false, index: true },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

AuditLogSchema.index({ branchId: 1, timestamp: -1 });

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
