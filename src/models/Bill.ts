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
  waiveOff: number;       // Discount / waived amount
  paymentStatus: 'Pending' | 'Paid';
  billModified: boolean;   // Bill edited after generation
  reprintCount: number;   // How many times reprinted
  synced: boolean;
  syncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BillSchema = new Schema<IBill>(
  {
    _id:           { type: Schema.Types.Mixed },
    billNumber:    { type: String, required: true },
    branchId:      { type: Schema.Types.Mixed, ref: 'Branch', required: true },
    orderId:       { type: Schema.Types.Mixed, ref: 'Order', required: true },
    tableNumber:   { type: String, required: true },
    subtotal:      { type: Number, required: true },
    cgst:          { type: Number, required: true },
    sgst:          { type: Number, required: true },
    grandTotal:    { type: Number, required: true },
    waiveOff:      { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['Pending', 'Paid'], default: 'Pending' },
    billModified:  { type: Boolean, default: false },
    reprintCount:  { type: Number, default: 0 },
    synced:        { type: Boolean, default: false, index: true },
    syncedAt:      { type: Date },
  },
  { timestamps: true }
);

BillSchema.index({ branchId: 1, createdAt: -1 });
BillSchema.index({ orderId: 1 });

export default mongoose.model<IBill>('Bill', BillSchema);
