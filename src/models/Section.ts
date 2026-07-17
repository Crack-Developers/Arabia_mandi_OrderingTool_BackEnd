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
    _id: { type: Schema.Types.Mixed },
    branchId: { type: Schema.Types.Mixed, ref: 'Branch', required: true },
    name: { type: String, required: true },
    printerId: { type: String, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model<ISection>('Section', SectionSchema);
