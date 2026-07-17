import mongoose, { Schema, Document } from 'mongoose';

export interface ISyncQueueItem extends Document {
  entity?: string;
  operation?: string;
  table?: string;
  recordId?: string;
  action?: string;
  payload: any;
  synced: boolean;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const SyncQueueSchema = new Schema<ISyncQueueItem>(
  {
    entity: { type: String, required: false },
    operation: { type: String, required: false },
    table: { type: String, required: false, index: true },
    recordId: { type: String, required: false },
    action: { type: String, required: false },
    payload: { type: Schema.Types.Mixed, required: true },
    synced: { type: Boolean, default: false, index: true },
    retryCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model<ISyncQueueItem>('SyncQueue', SyncQueueSchema);
