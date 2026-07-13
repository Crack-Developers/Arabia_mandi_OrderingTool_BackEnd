import mongoose, { Schema, Document } from 'mongoose';

export interface IPrinter extends Document {
  name: string;
  ip: string;
  port: number;
  type: 'thermal' | 'ipp' | 'pdf';
  duty: 'KOT' | 'RECEIPT' | 'BOTH';
  sections: string[];
  branchId?: mongoose.Types.ObjectId;
  isActive: boolean;
  status: 'online' | 'offline' | 'ready';
  connection: 'LAN' | 'USB/LAN' | 'WIFI';
  createdAt: Date;
  updatedAt: Date;
}

const PrinterSchema = new Schema<IPrinter>(
  {
    name:      { type: String, required: true },
    ip:        { type: String, required: true },
    port:      { type: Number, default: 9100 },
    type:      { type: String, enum: ['thermal', 'ipp', 'pdf'], default: 'thermal' },
    duty:      { type: String, enum: ['KOT', 'RECEIPT', 'BOTH'], default: 'KOT' },
    sections:  [{ type: String }],
    branchId:  { type: Schema.Types.ObjectId, ref: 'Branch' },
    isActive:  { type: Boolean, default: true },
    status:    { type: String, enum: ['online', 'offline', 'ready'], default: 'offline' },
    connection:{ type: String, enum: ['LAN', 'USB/LAN', 'WIFI'], default: 'LAN' },
  },
  { timestamps: true }
);

export default mongoose.model<IPrinter>('Printer', PrinterSchema);
