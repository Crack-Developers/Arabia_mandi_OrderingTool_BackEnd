/**
 * replay-pending-sync.js
 * Connects to the CORRECT database (test) and replays all pending SyncQueue items.
 * 
 * Usage: node replay-pending-sync.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// The production Render server uses the 'test' database (Mongoose default when no DB is specified)
const MONGO_URI = (process.env.MONGODB_URI || '').replace('/arabian_mandi_erp', '/test');

// ─── Models ──────────────────────────────────────────────────────────────────

const Mixed = mongoose.Schema.Types.Mixed;

const SyncQueue = mongoose.model('SyncQueue', new mongoose.Schema({
  entity: String, operation: String, table: String,
  recordId: String, action: String, payload: Mixed,
  synced: { type: Boolean, default: false },
}, { timestamps: true, strict: false }));

const OrderItemSchema = new mongoose.Schema({
  _id: Mixed, menuItemId: Mixed, name: String, variantName: String,
  price: Number, quantity: Number, taxRate: { type: Number, default: 0 },
  addons: [{ name: String, price: Number }], notes: String,
  kotSequence: Number, kotPrinted: Boolean,
}, { _id: true });

const KOTSchema = new mongoose.Schema({
  _id: Mixed, kotNumber: String, sequence: Number, items: [OrderItemSchema],
  printedAt: String, printedBy: String, reprintCount: { type: Number, default: 0 },
  status: { type: String, default: 'Active' },
}, { _id: true });

const Order = mongoose.model('Order', new mongoose.Schema({
  _id: Mixed, orderNumber: { type: String, required: true },
  branchId: { type: Mixed, required: true }, tableId: { type: Mixed, required: true },
  tableNumber: { type: String, required: true }, staffId: { type: Mixed, required: true },
  orderType: { type: String, default: 'DineIn' },
  status: { type: String, default: 'Active' },
  items: [OrderItemSchema], kots: [KOTSchema],
  subtotal: { type: Number, default: 0 }, cgst: { type: Number, default: 0 },
  sgst: { type: Number, default: 0 }, total: { type: Number, default: 0 },
  completedAt: Date, tableShiftCount: { type: Number, default: 0 },
  synced: Boolean, syncedAt: Date,
}, { timestamps: true }));

const Bill = mongoose.model('Bill', new mongoose.Schema({
  _id: Mixed, billNumber: { type: String, required: true },
  branchId: { type: Mixed, required: true }, orderId: { type: Mixed, required: true },
  tableNumber: { type: String, required: true },
  subtotal: { type: Number, required: true }, cgst: { type: Number, required: true },
  sgst: { type: Number, required: true }, grandTotal: { type: Number, required: true },
  waiveOff: { type: Number, default: 0 },
  paymentStatus: { type: String, default: 'Pending' },
  billModified: { type: Boolean, default: false }, reprintCount: { type: Number, default: 0 },
  synced: Boolean,
}, { timestamps: true }));

const Payment = mongoose.model('Payment', new mongoose.Schema({
  _id: Mixed, billId: { type: Mixed, required: true },
  branchId: Mixed, orderId: Mixed,
  cash: { type: Number, default: 0 }, card: { type: Number, default: 0 },
  upi: { type: Number, default: 0 }, other: { type: Number, default: 0 },
  totalPaid: { type: Number, required: true }, paymentTime: String, synced: Boolean,
}, { timestamps: true }));

const Table = mongoose.model('Table', new mongoose.Schema({ _id: Mixed }, { timestamps: true, strict: false }));
const MenuItem = mongoose.model('MenuItem', new mongoose.Schema({ _id: Mixed }, { timestamps: true, strict: false }));
const Category = mongoose.model('Category', new mongoose.Schema({ _id: Mixed }, { timestamps: true, strict: false }));
const Printer = mongoose.model('Printer', new mongoose.Schema({ _id: Mixed }, { timestamps: true, strict: false }));
const Section = mongoose.model('Section', new mongoose.Schema({ _id: Mixed }, { timestamps: true, strict: false }));
const Staff = mongoose.model('Staff', new mongoose.Schema({ _id: Mixed }, { timestamps: true, strict: false }));
const Branch = mongoose.model('Branch', new mongoose.Schema({ _id: Mixed, sections: [Mixed] }, { timestamps: true, strict: false }));

// ─── Apply sync item ────────────────────────────────────────────────────────

async function applySyncItemToDb(item) {
  const target = (item.table || item.entity || '').toLowerCase();
  const action = (item.action || item.operation || '').toUpperCase();
  const payload = item.payload;
  if (!payload) return;

  const docId = payload._id || item.recordId;
  if (!docId) return;
  const docIdStr = String(docId);

  // Build flexible ID filter
  const docIds = [docIdStr];
  if (mongoose.Types.ObjectId.isValid(docIdStr)) {
    docIds.push(new mongoose.Types.ObjectId(docIdStr));
  }
  const idFilter = { _id: { $in: docIds } };

  if (action === 'DELETE') {
    const models = {
      orders: Order, order: Order, bills: Bill, bill: Bill,
      payments: Payment, payment: Payment, tables: Table, table: Table,
      menu_items: MenuItem, menuitem: MenuItem, categories: Category, category: Category,
      printers: Printer, printer: Printer, sections: Section, section: Section, staff: Staff,
    };
    const M = models[target];
    if (M) await M.deleteOne(idFilter);
    return;
  }

  // Skip kots — embedded in orders via order UPDATE
  if (target === 'kots' || target === 'kot') return;

  const upsertOpts = { upsert: true, new: true, setDefaultsOnInsert: true, timestamps: false };

  if (target === 'orders' || target === 'order') {
    await Order.findOneAndUpdate({ _id: docIdStr }, {
      ...payload,
      orderNumber: payload.orderNumber || payload.order_number || `#ORD-${docIdStr.slice(0, 6)}`,
      branchId: payload.branchId || payload.branch_id,
      tableId: payload.tableId || payload.table_id || 'unknown',
      tableNumber: payload.tableNumber || '',
      staffId: payload.staffId || payload.staff_id || 'unknown',
      subtotal: payload.subtotal || 0,
      total: payload.total || payload.subtotal || 0,
    }, upsertOpts);
  } else if (target === 'bills' || target === 'bill') {
    await Bill.findOneAndUpdate({ _id: docIdStr }, {
      ...payload,
      billNumber: payload.billNumber || payload.bill_number || `BILL-${docIdStr.slice(0, 8)}`,
      branchId: payload.branchId || payload.branch_id,
      orderId: payload.orderId || payload.order_id,
      tableNumber: payload.tableNumber || '',
      subtotal: payload.subtotal || 0,
      cgst: payload.cgst || (payload.tax || 0) / 2,
      sgst: payload.sgst || (payload.tax || 0) / 2,
      grandTotal: payload.grandTotal || payload.total || payload.subtotal || 0,
      paymentStatus: payload.paymentStatus || (payload.status === 'unpaid' ? 'Pending' : 'Paid'),
    }, upsertOpts);
  } else if (target === 'payments' || target === 'payment') {
    await Payment.findOneAndUpdate({ _id: docIdStr }, {
      ...payload,
      billId: payload.billId || payload.bill_id || docIdStr,
      branchId: payload.branchId || payload.branch_id,
      orderId: payload.orderId || payload.order_id,
      totalPaid: payload.totalPaid || payload.total || (payload.cash || 0) + (payload.card || 0) + (payload.upi || 0),
    }, upsertOpts);
  } else {
    const models = {
      tables: Table, table: Table, menu_items: MenuItem, menuitem: MenuItem,
      categories: Category, category: Category, printers: Printer, printer: Printer,
      sections: Section, section: Section, staff: Staff,
    };
    const M = models[target];
    if (M) {
      const existing = await M.findOne(idFilter);
      if (existing) {
        const ud = { ...payload }; delete ud._id;
        await M.updateOne({ _id: existing._id }, ud);
      } else {
        // For staff, ensure password field
        if (target === 'staff' && !payload.password) {
          payload.password = '$2a$10$dummyhashedpasswordfordesktopwaiters';
        }
        if (target === 'staff' && (!payload.employeeCode || payload.employeeCode === '')) {
          payload.employeeCode = `EMP-SYNC-${Date.now()}-${Math.floor(Math.random()*1000)}`;
        }
        await M.create({ ...payload, _id: docIdStr });
      }
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Connecting to MongoDB Atlas (test database)...');
  console.log('URI:', MONGO_URI.replace(/:([^@]+)@/, ':***@'));
  await mongoose.connect(MONGO_URI);
  console.log('Connected to:', mongoose.connection.name, '\n');

  const pending = await SyncQueue.countDocuments({ synced: false });
  const synced = await SyncQueue.countDocuments({ synced: true });
  console.log(`SyncQueue: ${pending} pending, ${synced} synced, ${pending + synced} total\n`);

  // Breakdown
  const breakdown = await SyncQueue.aggregate([
    { $match: { synced: false } },
    { $group: {
      _id: { table: { $ifNull: ['$table', '$entity'] }, action: { $ifNull: ['$action', '$operation'] } },
      count: { $sum: 1 },
    }},
    { $sort: { count: -1 } },
  ]);
  console.log('Pending breakdown:');
  for (const b of breakdown) console.log(`  ${b._id.table}/${b._id.action}: ${b.count}`);
  console.log('');

  if (pending === 0) {
    console.log('Nothing to replay.');
    await mongoose.disconnect();
    return;
  }

  // Replay
  const BATCH = 100;
  let totalOk = 0, totalFail = 0, totalProc = 0;
  const errors = [];

  while (true) {
    const items = await SyncQueue.find({ synced: false }).sort({ createdAt: 1 }).limit(BATCH).lean();
    if (!items.length) break;

    let ok = 0, fail = 0;
    for (const item of items) {
      try {
        await applySyncItemToDb(item);
        await SyncQueue.updateOne({ _id: item._id }, { synced: true });
        ok++;
      } catch (err) {
        fail++;
        // Mark failed items as synced too to avoid infinite loop — data is still in SyncQueue for audit
        await SyncQueue.updateOne({ _id: item._id }, { synced: true, applyError: err.message });
        if (errors.length < 30) errors.push({
          table: item.table || item.entity, action: item.action || item.operation,
          recordId: item.recordId, error: err.message,
        });
      }
    }

    totalProc += items.length; totalOk += ok; totalFail += fail;
    const remaining = await SyncQueue.countDocuments({ synced: false });
    process.stdout.write(`\r  Processed: ${totalProc}/${pending} | ✓${totalOk} ✗${totalFail} | Remaining: ${remaining}   `);
  }

  console.log(`\n\n${'═'.repeat(50)}`);
  console.log(`REPLAY COMPLETE`);
  console.log(`  Processed: ${totalProc}`);
  console.log(`  Applied:   ${totalOk}`);
  console.log(`  Errors:    ${totalFail}`);
  console.log(`  Remaining: ${await SyncQueue.countDocuments({ synced: false })}`);
  console.log(`${'═'.repeat(50)}\n`);

  if (errors.length) {
    console.log('Sample errors (first 10):');
    for (const e of errors.slice(0, 10)) console.log(`  [${e.table}/${e.action}] ${e.recordId}: ${e.error}`);
  }

  // Verify
  console.log('\nPost-replay counts:');
  console.log('  Orders:', await Order.countDocuments());
  console.log('  Bills:', await Bill.countDocuments());
  console.log('  Payments:', await Payment.countDocuments());
  console.log('  Tables:', await Table.countDocuments());
  console.log('  Categories:', await Category.countDocuments());
  console.log('  MenuItems:', await MenuItem.countDocuments());

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
