import mongoose, { Schema, Document } from 'mongoose';

export type UserRole = 'Super Admin' | 'Receptionist' | 'Manager' | 'Cashier' | 'Waiter' | 'System';

export interface IStaff extends Document {
  employeeCode: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  branchId: mongoose.Types.ObjectId;
  active: boolean;
  designation?: string;
  username: string;
  password: string;
  branchAccess?: string;
  createdAt: Date;
  updatedAt: Date;
}

const StaffSchema = new Schema<IStaff>(
  {
    _id: { type: Schema.Types.Mixed, default: () => new mongoose.Types.ObjectId() },
    employeeCode: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    role: {
      type: String,
      enum: ['Super Admin', 'Receptionist', 'Manager', 'Cashier', 'Waiter', 'System'],
      required: true,
    },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    active: { type: Boolean, default: true },
    designation: { type: String },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    branchAccess: { type: String },
    pin: { type: String },
    assignedSections: [{ type: String }],
  },
  { timestamps: true }
);

export default mongoose.model<IStaff>('Staff', StaffSchema);
