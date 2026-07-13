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
    employeeCode: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
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
  },
  { timestamps: true }
);

export default mongoose.model<IStaff>('Staff', StaffSchema);
