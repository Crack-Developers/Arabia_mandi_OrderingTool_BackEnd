import mongoose, { Schema, Document } from 'mongoose';

export interface ISyncQueueItem extends Document {
  entity: 'Order' | 'Table' | 'Bill' | 'Payment';
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: any;
  synced: boolean;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const SyncQueueSchema = new Schema<ISyncQueueItem>(
  {
    entity: { type: String, enum: ['Order', 'Table', 'Bill', 'Payment'], required: true },
    operation: { type: String, enum: ['CREATE', 'UPDATE', 'DELETE'], required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    synced: { type: Boolean, default: false },
    retryCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model<ISyncQueueItem>('SyncQueue', SyncQueueSchema);
