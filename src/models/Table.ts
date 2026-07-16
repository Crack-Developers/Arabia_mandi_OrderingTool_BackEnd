import mongoose, { Schema, Document } from 'mongoose';

export type TableStatus = 'Available' | 'Reserved' | 'Occupied' | 'Billing' | 'Merged';

export interface IReservation {
  customerName: string;
  phone: string;
  reservedAt: string;
  expiresAt: string;
  guests: number;
}

export interface ITable extends Document {
  branchId: mongoose.Types.ObjectId;
  sectionId: mongoose.Types.ObjectId;
  tableNumber: string;
  capacity: number;
  status: TableStatus;
  mergedWith?: string[];
  currentOrderId?: mongoose.Types.ObjectId;
  reservation?: IReservation;
  occupiedSince?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TableSchema = new Schema<ITable>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    sectionId: { type: Schema.Types.Mixed, required: true },
    tableNumber: { type: String, required: true },
    capacity: { type: Number, required: true },
    status: {
      type: String,
      enum: ['Available', 'Reserved', 'Occupied', 'Billing', 'Merged'],
      default: 'Available',
    },
    mergedWith: [{ type: String }],
    currentOrderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    reservation: {
      customerName: String,
      phone: String,
      reservedAt: String,
      expiresAt: String,
      guests: Number,
    },
    occupiedSince: { type: String },
  },
  { timestamps: true }
);

TableSchema.index({ branchId: 1, tableNumber: 1 }, { unique: true });

export default mongoose.model<ITable>('Table', TableSchema);
