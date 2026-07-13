import mongoose, { Schema, Document } from 'mongoose';

export interface IOrderItem {
  menuItemId: mongoose.Types.ObjectId;
  name: string;
  variantName: string;
  price: number;
  quantity: number;
  addons: { name: string; price: number }[];
  notes?: string;
  kotSequence: number;
}

export interface IKOT {
  kotNumber: string;
  sequence: number;
  items: IOrderItem[];
  printedAt: string;
  printedBy: string;
  reprintCount: number;
}

export interface IOrder extends Document {
  orderNumber: string;
  branchId: mongoose.Types.ObjectId;
  tableId: mongoose.Types.ObjectId;
  tableNumber: string;
  staffId: mongoose.Types.ObjectId;
  status: 'Active' | 'Completed' | 'Cancelled';
  items: IOrderItem[];
  kots: IKOT[];
  subtotal: number;
  cgst: number;
  sgst: number;
  total: number;
  synced: boolean;
  syncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OrderItemSchema = new Schema(
  {
    menuItemId: { type: Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    name: { type: String, required: true },
    variantName: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    addons: [{ name: String, price: Number }],
    notes: { type: String },
    kotSequence: { type: Number, default: 1 },
  },
  { _id: true }
);

const KOTSchema = new Schema(
  {
    kotNumber: { type: String, required: true },
    sequence: { type: Number, required: true },
    items: [OrderItemSchema],
    printedAt: { type: String },
    printedBy: { type: String },
    reprintCount: { type: Number, default: 0 },
  },
  { _id: true }
);

const OrderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true, unique: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', required: true },
    tableNumber: { type: String, required: true },
    staffId: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
    status: {
      type: String,
      enum: ['Active', 'Completed', 'Cancelled'],
      default: 'Active',
    },
    items: [OrderItemSchema],
    kots: [KOTSchema],
    subtotal: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    synced: { type: Boolean, default: false, index: true },
    syncedAt: { type: Date },
  },
  { timestamps: true }
);

OrderSchema.index({ branchId: 1, createdAt: -1 });
OrderSchema.index({ tableId: 1 });

export default mongoose.model<IOrder>('Order', OrderSchema);
