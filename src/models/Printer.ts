import mongoose, { Schema, Document } from 'mongoose';

export interface IPrinter extends Document {
  name: string;
  ip: string;
  port: number;
  type: 'thermal' | 'ipp' | 'pdf';
  duty: 'KOT' | 'RECEIPT' | 'BOTH';
  role?: string;
  sections: string[];
  branchId?: mongoose.Types.ObjectId;
  isActive: boolean;
  status: 'online' | 'offline' | 'ready';
  connection: 'LAN' | 'USB/LAN' | 'WIFI';
  // ── Permanent hardware identity ───────────────────────────────────────────
  // usbSerial: extracted from CUPS device URI (?serial=...)
  //   — survives USB disconnect, port change, OS reboot.
  //   — used to re-match this DB record when the same printer reconnects.
  usbSerial?: string;
  // cupsName: the current OS CUPS queue name (may change between reconnects
  //   if the printer registers on a different USB port).
  cupsName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PrinterSchema = new Schema<IPrinter>(
  {
    _id:        { type: Schema.Types.Mixed },
    name:       { type: String, required: true },
    ip:         { type: String, required: true },
    port:       { type: Number, default: 9100 },
    type:       { type: String, enum: ['thermal', 'ipp', 'pdf'], default: 'thermal' },
    duty:       { type: String, enum: ['KOT', 'RECEIPT', 'BOTH'], default: 'KOT' },
    role:       { type: String },
    sections:   [{ type: String }],
    branchId:   { type: Schema.Types.Mixed, ref: 'Branch' },
    isActive:   { type: Boolean, default: true },
    status:     { type: String, enum: ['online', 'offline', 'ready'], default: 'offline' },
    connection: { type: String, enum: ['LAN', 'USB/LAN', 'WIFI'], default: 'LAN' },
    usbSerial:  { type: String },   // permanent hardware fingerprint
    cupsName:   { type: String },   // current OS CUPS queue name
  },
  { timestamps: true }
);

// Sparse unique index — same physical printer never stored twice
PrinterSchema.index({ usbSerial: 1 }, { unique: true, sparse: true });

export default mongoose.model<IPrinter>('Printer', PrinterSchema);
