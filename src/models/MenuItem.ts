import mongoose, { Schema, Document } from 'mongoose';

export interface IMenuVariant {
  name: string;
  price: number;
}

export interface IAddon {
  name: string;
  price: number;
}

export interface IMenuItem extends Document {
  branchId?: mongoose.Types.ObjectId | string;
  categoryId: mongoose.Types.ObjectId;
  name: string;
  description: string;
  available: boolean;
  active: boolean;
  variants: IMenuVariant[];
  addons: IAddon[];
  badge?: string;
  core?: number;
  taxRate?: number;
  printerId?: mongoose.Types.ObjectId;
  sections?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const MenuItemSchema = new Schema<IMenuItem>(
  {
    _id: { type: Schema.Types.Mixed },
    branchId: { type: Schema.Types.Mixed, index: true, default: null }, // null = shared/global
    categoryId: { type: Schema.Types.Mixed, ref: 'Category', required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    available: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    variants: [
      {
        name: { type: String, required: true },
        price: { type: Number, required: true },
      },
    ],
    addons: [
      {
        name: { type: String, required: true },
        price: { type: Number, required: true },
      },
    ],
    badge: { type: String },
    core: { type: Number, default: null },
    taxRate: { type: Number, default: 5 },
    printerId: { type: Schema.Types.Mixed, ref: 'Printer' },
    sections: [{ type: String }],
  },
  { timestamps: true }
);

export default mongoose.model<IMenuItem>('MenuItem', MenuItemSchema);
