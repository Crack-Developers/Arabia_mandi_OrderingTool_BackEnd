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
  categoryId: mongoose.Types.ObjectId;
  name: string;
  description: string;
  available: boolean;
  active: boolean;
  variants: IMenuVariant[];
  addons: IAddon[];
  badge?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MenuItemSchema = new Schema<IMenuItem>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
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
  },
  { timestamps: true }
);

export default mongoose.model<IMenuItem>('MenuItem', MenuItemSchema);
