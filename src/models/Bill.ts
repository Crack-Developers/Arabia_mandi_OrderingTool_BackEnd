import mongoose, { Schema, Document } from 'mongoose';

export interface IBill extends Document {
  billNumber: string;
  branchId: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  tableNumber: string;
  subtotal: number;
  cgst: number;
  sgst: number;
  grandTotal: number;
  paymentStatus: 'Pending' | 'Paid';
  synced: boolean;
  syncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BillSchema = new Schema<IBill>(
  {
    billNumber: { type: String, required: true, unique: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    tableNumber: { type: String, required: true },
    subtotal: { type: Number, required: true },
    cgst: { type: Number, required: true },
    sgst: { type: Number, required: true },
    grandTotal: { type: Number, required: true },
    paymentStatus: { type: String, enum: ['Pending', 'Paid'], default: 'Pending' },
    synced: { type: Boolean, default: false, index: true },
    syncedAt: { type: Date },
  },
  { timestamps: true }
);

BillSchema.index({ branchId: 1, createdAt: -1 });

export default mongoose.model<IBill>('Bill', BillSchema);
