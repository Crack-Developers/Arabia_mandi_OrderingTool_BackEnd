import SyncQueue from '../models/SyncQueue';
import Order from '../models/Order';
import Bill from '../models/Bill';
import Payment from '../models/Payment';
import Table from '../models/Table';
import MenuItem from '../models/MenuItem';
import Category from '../models/Category';
import Printer from '../models/Printer';
import Section from '../models/Section';
import Branch from '../models/Branch';
import Staff from '../models/Staff';

export const syncService = {
  async upload(items: any[]) {
    if (!Array.isArray(items) || items.length === 0) return [];

    const results = await Promise.all(
      items.map(async (item) => {
        // 1. Log to SyncQueue
        let saved: any;
        try {
          const syncItem = new SyncQueue(item);
          saved = await syncItem.save();
        } catch (e: any) {
          saved = { ...item, synced: false };
        }

        // 2. Apply directly to MongoDB Target Collection
        try {
          await applySyncItemToDb(item);
          if (saved && typeof saved.save === 'function') {
            saved.synced = true;
            await saved.save();
          } else if (saved && saved._id) {
            await SyncQueue.updateOne({ _id: saved._id }, { synced: true });
            saved.synced = true;
          }
        } catch (applyErr: any) {
          console.warn(`[SyncService] Could not apply item ${item.recordId || item._id} to collection ${item.table || item.entity}:`, applyErr.message);
        }

        return saved;
      })
    );

    return results;
  },

  async getStatus() {
    const pending = await SyncQueue.countDocuments({ synced: false });
    const synced = await SyncQueue.countDocuments({ synced: true });
    return { pending, synced, total: pending + synced };
  },

  async markSynced(ids: string[]) {
    await SyncQueue.updateMany({ _id: { $in: ids } }, { synced: true });
    return { message: `${ids.length} items marked as synced.` };
  },

  async clearSynced() {
    await SyncQueue.deleteMany({ synced: true });
    return { message: 'All synced items cleared.' };
  },

  /** Analyze pending (failed-to-apply) sync queue items */
  async diagnose() {
    const pending = await SyncQueue.countDocuments({ synced: false });
    const synced = await SyncQueue.countDocuments({ synced: true });

    // Breakdown by table/action
    const breakdown = await SyncQueue.aggregate([
      { $match: { synced: false } },
      { $group: {
        _id: { table: { $ifNull: ['$table', '$entity'] }, action: { $ifNull: ['$action', '$operation'] } },
        count: { $sum: 1 },
        earliest: { $min: '$createdAt' },
        latest: { $max: '$createdAt' },
        sampleRecordId: { $first: '$recordId' },
      }},
      { $sort: { count: -1 } },
    ]);

    // Get a few sample items to see error patterns
    const samples = await SyncQueue.find({ synced: false })
      .sort({ createdAt: 1 })
      .limit(5)
      .select('table entity action operation recordId payload createdAt')
      .lean();

    return { pending, synced, total: pending + synced, breakdown, samples };
  },

  /** Re-attempt applying all pending sync queue items to target MongoDB collections */
  async replay(batchSize: number = 100) {
    const pendingItems = await SyncQueue.find({ synced: false })
      .sort({ createdAt: 1 })
      .limit(batchSize)
      .lean();

    let success = 0;
    let failed = 0;
    const errors: { id: string; table: string; error: string }[] = [];

    await Promise.all(
      pendingItems.map(async (item) => {
        try {
          await applySyncItemToDb(item);
          await SyncQueue.updateOne({ _id: item._id }, { synced: true });
          success++;
        } catch (err: any) {
          failed++;
          errors.push({
            id: String(item._id),
            table: item.table || item.entity || 'unknown',
            error: err.message || String(err),
          });
        }
      })
    );

    const remaining = await SyncQueue.countDocuments({ synced: false });
    return { processed: pendingItems.length, success, failed, remaining, errors: errors.slice(0, 20) };
  },
};

// ── BranchId remapping cache ──────────────────────────────────────────────────
// If a payload arrives with a deleted/orphaned branchId, automatically remap it
// to the correct active branch. Cache results in memory for the life of the server.
const _branchIdCache: Map<string, string> = new Map();

async function resolveActiveBranchId(rawBranchId: string): Promise<string> {
  if (!rawBranchId) return rawBranchId;
  const key = String(rawBranchId);
  if (_branchIdCache.has(key)) return _branchIdCache.get(key)!;

  // Check if this branchId belongs to an active branch
  const active = await Branch.findById(key).lean();
  if (active) {
    _branchIdCache.set(key, key); // it's valid, keep it
    return key;
  }

  // branchId is orphaned (branch was deleted). Try to find the best active branch.
  // Heuristic: pick the most recently created active branch (or the only one).
  const allActive = await Branch.find({ status: 'Active' }).sort({ createdAt: -1 }).lean();
  if (allActive.length === 1) {
    const remapped = String(allActive[0]._id);
    console.log(`[SyncService] ⚠️ Orphaned branchId ${key} → remapped to ${remapped} (${allActive[0].name})`);
    _branchIdCache.set(key, remapped);
    return remapped;
  }

  // Multiple active branches: return as-is and let it land (admin can clean up)
  console.warn(`[SyncService] ⚠️ Orphaned branchId ${key} — multiple active branches found, cannot auto-remap.`);
  _branchIdCache.set(key, key);
  return key;
}

async function applySyncItemToDb(item: any) {
  const target = (item.table || item.entity || '').toLowerCase();
  const action = (item.action || item.operation || '').toUpperCase();
  const payload = item.payload;
  if (!payload) return;

  const docId = payload._id || item.recordId;
  if (!docId) return;

  // ── Auto-remap orphaned branchIds before writing anything ─────────────────
  if (payload.branchId) {
    payload.branchId = await resolveActiveBranchId(String(payload.branchId));
  }

  const docIdStr = String(docId);
  const docIds = [docIdStr];
  if (require('mongoose').Types.ObjectId.isValid(docIdStr)) {
    docIds.push(new (require('mongoose').Types.ObjectId)(docIdStr));
  }
  const idFilter = { _id: { $in: docIds } };

  if (action === 'DELETE') {
    if (target === 'orders' || target === 'order') await Order.deleteOne(idFilter);
    else if (target === 'bills' || target === 'bill') await Bill.deleteOne(idFilter);
    else if (target === 'payments' || target === 'payment') await Payment.deleteOne(idFilter);
    else if (target === 'tables' || target === 'table') {
      const table = await Table.findOne(idFilter);
      if (table) {
        if (table.branchId && table.sectionName) {
          await Branch.updateOne(
            { _id: table.branchId, "sections.name": table.sectionName },
            { $inc: { "sections.$.tablesCount": -1 } }
          );
          await Branch.updateOne(
            { _id: table.branchId },
            { $pull: { sections: { name: table.sectionName, tablesCount: { $lte: 0 } } } }
          );
        } else if (table.branchId && table.sectionId) {
          try {
            await Branch.updateOne(
              { _id: table.branchId, "sections._id": table.sectionId },
              { $inc: { "sections.$.tablesCount": -1 } }
            );
            await Branch.updateOne(
              { _id: table.branchId },
              { $pull: { sections: { _id: table.sectionId, tablesCount: { $lte: 0 } } } }
            );
          } catch (e) {} // Ignore cast errors if sectionId is not an ObjectId
        }
        await table.deleteOne();
      }
    }
    else if (target === 'menu_items' || target === 'menuitem') await MenuItem.deleteOne(idFilter);
    else if (target === 'categories' || target === 'category') await Category.deleteOne(idFilter);
    else if (target === 'printers' || target === 'printer') await Printer.deleteOne(idFilter);
    else if (target === 'sections' || target === 'section') {
      const section = await Section.findOne(idFilter);
      if (section) {
        if (section.branchId && section.name) {
          await Branch.updateOne(
            { _id: section.branchId },
            { $pull: { sections: { name: section.name } } }
          );
        }
        await section.deleteOne();
      }
    }
    else if (target === 'staff') await Staff.deleteOne(idFilter);
    return;
  }

  // INSERT, UPDATE, CREATE
  const updateOpts = { upsert: true, new: true, setDefaultsOnInsert: true, timestamps: false };
  if (target === 'orders' || target === 'order') {
    const orderPayload = {
      ...payload,
      orderNumber: payload.orderNumber || payload.order_number || `#ORD-${docId.slice(0, 6)}`,
      branchId: payload.branchId || payload.branch_id,
      tableId: payload.tableId || payload.table_id,
      staffId: payload.staffId || payload.staff_id,
      subtotal: payload.subtotal || 0,
      total: payload.total || payload.subtotal || 0,
    };
    await Order.findOneAndUpdate({ _id: docId }, orderPayload, updateOpts);
  } else if (target === 'bills' || target === 'bill') {
    const billPayload = {
      ...payload,
      billNumber: payload.billNumber || payload.bill_number || `BILL-${docId.slice(0, 8)}`,
      branchId: payload.branchId || payload.branch_id,
      orderId: payload.orderId || payload.order_id,
      subtotal: payload.subtotal || 0,
      cgst: payload.cgst || payload.tax / 2 || 0,
      sgst: payload.sgst || payload.tax / 2 || 0,
      grandTotal: payload.grandTotal || payload.total || payload.subtotal || 0,
      paymentStatus: payload.paymentStatus || (payload.status === 'unpaid' ? 'Pending' : 'Paid'),
    };
    await Bill.findOneAndUpdate({ _id: docId }, billPayload, updateOpts);
  } else if (target === 'payments' || target === 'payment') {
    const payPayload = {
      ...payload,
      billId: payload.billId || payload.bill_id || docId,
      branchId: payload.branchId || payload.branch_id,
      orderId: payload.orderId || payload.order_id,
      totalPaid: payload.totalPaid || payload.total || (payload.cash || 0) + (payload.card || 0) + (payload.upi || 0),
    };
    await Payment.findOneAndUpdate({ _id: docId }, payPayload, updateOpts);
  } else {
    let Model: any;
    if (target === 'tables' || target === 'table') Model = Table;
    else if (target === 'menu_items' || target === 'menuitem') Model = MenuItem;
    else if (target === 'categories' || target === 'category') Model = Category;
    else if (target === 'printers' || target === 'printer') Model = Printer;
    else if (target === 'sections' || target === 'section') Model = Section;
    else if (target === 'staff') Model = Staff;

    if (Model) {
      const existing = await Model.findOne(idFilter);
      
      if (target === 'staff') {
        if (!payload.password && existing) payload.password = existing.password;
        if (!payload.password && !existing) payload.password = '$2a$10$dummyhashedpasswordfordesktopwaiters';
        if (!payload.employeeCode || payload.employeeCode === '') {
          payload.employeeCode = `EMP-SYNC-${Date.now()}-${Math.floor(Math.random()*1000)}`;
        }
      }

      if (existing) {
        const updateData = { ...payload };
        delete updateData._id;
        await Model.updateOne({ _id: existing._id }, updateData);
      } else {
        await Model.create({ ...payload, _id: docIdStr });
      }
    }
  }
}
