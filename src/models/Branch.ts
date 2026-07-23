import mongoose, { Schema, Document } from 'mongoose';

export interface IBranch extends Document {
  branchCode: string;
  name: string;
  address: string;
  phone: string;
  gst: string;
  taxes: {
    cgst: number;
    sgst: number;
    serviceCharge: number;
    gstPercentage?: number;
    discountRule?: string;
    roundOffTotal?: boolean;
    pricesIncludeTax?: boolean;
  };
  receiptSettings?: {
    invoicePrefix: string;
    headerText: string;
    footerText: string;
    printLogo: boolean;
    autoPrintOnCheckout: boolean;
    useThermalFormat: boolean;
    paperWidth: string;
  };
  timings: string;
  status: 'Active' | 'Inactive';
  managerName?: string;
  managerId?: string;
  sections?: {
    name: string;
    tablesCount?: number;
    description?: string;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const BranchSchema = new Schema<IBranch>(
  {
    branchCode: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    address: { type: String, required: true },
    phone: { type: String, required: true },
    gst: { type: String, required: true },
    taxes: {
      cgst: { type: Number, default: 2.5 },
      sgst: { type: Number, default: 2.5 },
      serviceCharge: { type: Number, default: 0 },
      gstPercentage: { type: Number },
      discountRule: { type: String },
      roundOffTotal: { type: Boolean, default: true },
      pricesIncludeTax: { type: Boolean, default: false },
    },
    receiptSettings: {
      invoicePrefix: { type: String, default: 'INV-' },
      headerText: { type: String, default: 'Welcome to Arabian Mandhi!' },
      footerText: { type: String, default: 'Thank you for visiting! Please come again.' },
      printLogo: { type: Boolean, default: false },
      autoPrintOnCheckout: { type: Boolean, default: true },
      useThermalFormat: { type: Boolean, default: true },
      paperWidth: { type: String, default: '80mm' },
    },
    timings: { type: String, default: '12:00 PM – 11:30 PM' },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
    managerName: { type: String },
    managerId: { type: String },
    sections: [
      {
        name: { type: String, required: true },
        tablesCount: { type: Number, default: 10 },
        description: { type: String },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model<IBranch>('Branch', BranchSchema);
