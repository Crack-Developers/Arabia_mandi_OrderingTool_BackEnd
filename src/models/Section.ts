import mongoose, { Schema, Document } from 'mongoose';

export interface ISection extends Document {
  branchId: mongoose.Types.ObjectId;
  name: string;
  printerId: string;
  createdAt: Date;
  updatedAt: Date;
}

const SectionSchema = new Schema<ISection>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    name: { type: String, required: true },
    printerId: { type: String, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model<ISection>('Section', SectionSchema);
