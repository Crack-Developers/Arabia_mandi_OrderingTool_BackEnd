import mongoose, { Schema, Document } from 'mongoose';

export interface IPayment extends Document {
  billId: mongoose.Types.ObjectId;
  cash: number;
  card: number;
  upi: number;
  totalPaid: number;
  paymentTime: string;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    billId: { type: Schema.Types.ObjectId, ref: 'Bill', required: true },
    cash: { type: Number, default: 0 },
    card: { type: Number, default: 0 },
    upi: { type: Number, default: 0 },
    totalPaid: { type: Number, required: true },
    paymentTime: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<IPayment>('Payment', PaymentSchema);
