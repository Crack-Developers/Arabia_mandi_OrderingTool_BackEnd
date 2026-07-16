import mongoose, { Document, Schema } from 'mongoose';

export type PrintJobType = 'KOT' | 'RECEIPT' | 'TEST';
export type PrintJobStatus = 'Pending' | 'Printing' | 'Completed' | 'Failed';

export interface IPrintJobAttempt {
  attemptedAt: Date;
  agentId?: string;
  status: 'Completed' | 'Failed';
  message?: string;
}

export interface IPrintJob extends Document {
  printerId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  orderId?: mongoose.Types.ObjectId;
  billId?: mongoose.Types.ObjectId;
  counterConfigId?: mongoose.Types.ObjectId;
  jobType: PrintJobType;
  payload: Record<string, any>;
  status: PrintJobStatus;
  retryCount: number;
  maxRetries: number;
  agentId?: string;
  lockedAt?: Date;
  lastError?: string;
  completedAt?: Date;
  attempts: IPrintJobAttempt[];
  createdAt: Date;
  updatedAt: Date;
}

const PrintJobAttemptSchema = new Schema<IPrintJobAttempt>(
  {
    attemptedAt: { type: Date, default: Date.now },
    agentId: { type: String },
    status: { type: String, enum: ['Completed', 'Failed'], required: true },
    message: { type: String },
  },
  { _id: false }
);

const PrintJobSchema = new Schema<IPrintJob>(
  {
    printerId: { type: Schema.Types.ObjectId, ref: 'Printer', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    billId: { type: Schema.Types.ObjectId, ref: 'Bill' },
    counterConfigId: { type: Schema.Types.ObjectId, ref: 'CounterConfiguration' },
    jobType: { type: String, enum: ['KOT', 'RECEIPT', 'TEST'], required: true, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['Pending', 'Printing', 'Completed', 'Failed'], default: 'Pending', index: true },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 10 },
    agentId: { type: String },
    lockedAt: { type: Date },
    lastError: { type: String },
    completedAt: { type: Date },
    attempts: { type: [PrintJobAttemptSchema], default: [] },
  },
  { timestamps: true }
);

PrintJobSchema.index({ status: 1, branchId: 1, createdAt: 1 });

export default mongoose.model<IPrintJob>('PrintJob', PrintJobSchema);
