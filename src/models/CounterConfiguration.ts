import mongoose, { Document, Schema } from 'mongoose';

export interface ICounterConfiguration extends Document {
  branchId: mongoose.Types.ObjectId;
  counterName: string;
  receiptPrinterId: mongoose.Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CounterConfigurationSchema = new Schema<ICounterConfiguration>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    counterName: { type: String, required: true, trim: true },
    receiptPrinterId: { type: Schema.Types.ObjectId, ref: 'Printer', required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

CounterConfigurationSchema.index({ branchId: 1, counterName: 1 }, { unique: true });

export default mongoose.model<ICounterConfiguration>('CounterConfiguration', CounterConfigurationSchema);
