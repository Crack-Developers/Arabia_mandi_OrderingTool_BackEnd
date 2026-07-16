import mongoose, { Schema, Document } from 'mongoose';

export interface IPayment extends Document {
  billId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;   // For fast branch-level aggregations
  orderId?: mongoose.Types.ObjectId;    // For tracing back to order
  cash: number;
  card: number;
  upi: number;
  other: number;                        // Any other payment method
  totalPaid: number;
  paymentTime: string;
  synced: boolean;
  syncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    billId:      { type: Schema.Types.ObjectId, ref: 'Bill', required: true },
    branchId:    { type: Schema.Types.ObjectId, ref: 'Branch' },
    orderId:     { type: Schema.Types.ObjectId, ref: 'Order' },
    cash:        { type: Number, default: 0 },
    card:        { type: Number, default: 0 },
    upi:         { type: Number, default: 0 },
    other:       { type: Number, default: 0 },
    totalPaid:   { type: Number, required: true },
    paymentTime: { type: String },
    synced:      { type: Boolean, default: false, index: true },
    syncedAt:    { type: Date },
  },
  { timestamps: true }
);

PaymentSchema.index({ branchId: 1, createdAt: -1 });
PaymentSchema.index({ billId: 1 });

export default mongoose.model<IPayment>('Payment', PaymentSchema);
