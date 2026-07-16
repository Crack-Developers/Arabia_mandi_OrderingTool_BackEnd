import mongoose, { Schema, Document } from 'mongoose';

export interface ICategory extends Document {
  branchId?: string;
  name: string;
  displayOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategory>(
  {
    branchId: { type: String, index: true, default: null }, // null = shared/global
    name: { type: String, required: true },
    displayOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model<ICategory>('Category', CategorySchema);
