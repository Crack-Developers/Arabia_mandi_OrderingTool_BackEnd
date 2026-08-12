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

    const itemPromises = items.map(async (item) => {
      const itemId = item.id || item.recordId || item._id;
      let saved: any = null;

      // 1. Log to SyncQueue
      try {
        const syncItemData = {
          table: item.table || item.entity,
          recordId: String(item.recordId || item.id || item._id || ''),
          action: item.action || item.operation,
          payload: item.payload,
          synced: false,
        };
        const syncItem = new SyncQueue(syncItemData);
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
        return {
          id: itemId,
          recordId: item.recordId || itemId,
          success: true,
          table: item.table || item.entity,
        };
      } catch (applyErr: any) {
        console.warn(`[SyncService] Could not apply item ${itemId} to collection ${item.table || item.entity}:`, applyErr.message);
        return {
          id: itemId,
          recordId: item.recordId || itemId,
          success: false,
          error: applyErr.message,
          table: item.table || item.entity,
        };
      }
    });

    const settled = await Promise.allSettled(itemPromises);
    const results = settled.map((s, idx) => {
      if (s.status === 'fulfilled') return s.value;
      const rawItem = items[idx];
      return {
        id: rawItem?.id || rawItem?.recordId || rawItem?._id,
        recordId: rawItem?.recordId || rawItem?.id || rawItem?._id,
        success: false,
        error: s.reason?.message || String(s.reason),
      };
    });

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
  const parseDate = (d: any) => {
    if (!d) return new Date();
    if (d instanceof Date) return d;
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  };
  const createdAtDate = parseDate(payload.createdAt || payload.created_at);
  const updatedAtDate = parseDate(payload.updatedAt || payload.updated_at);

  if (target === 'orders' || target === 'order') {
    let orderStatus = payload.status || 'Completed';
    const sLow = String(orderStatus).toLowerCase();
    if (sLow === 'completed' || sLow === 'paid' || sLow === 'billed' || sLow === 'settled') {
      orderStatus = 'Completed';
    } else if (sLow === 'cancelled') {
      orderStatus = 'Cancelled';
    } else {
      orderStatus = 'Active';
    }
    const orderPayload = {
      ...payload,
      orderNumber: payload.orderNumber || payload.order_number || `#ORD-${docId.slice(0, 6)}`,
      branchId: payload.branchId || payload.branch_id,
      tableId: payload.tableId || payload.table_id,
      staffId: payload.staffId || payload.staff_id,
      orderType: payload.orderType || 'DineIn',
      status: orderStatus,
      subtotal: Number(payload.subtotal) || 0,
      cgst: Number(payload.cgst || (payload.tax ? payload.tax / 2 : 0)) || 0,
      sgst: Number(payload.sgst || (payload.tax ? payload.tax / 2 : 0)) || 0,
      total: Number(payload.total !== undefined ? payload.total : payload.subtotal) || 0,
      createdAt: createdAtDate,
      updatedAt: updatedAtDate,
      completedAt: (orderStatus === 'Completed') ? parseDate(payload.completedAt || payload.completed_at || updatedAtDate) : undefined,
    };
    // FIX #4: Timestamp guard — only apply if incoming updatedAt >= existing updatedAt.
    // This prevents quarantined old events from reverting a Completed/Paid order back to Active.
    const orderFilter = {
      $or: [
        { _id: { $in: docIds }, updatedAt: { $lte: updatedAtDate } }, // existing doc is older — safe to overwrite
        { _id: { $in: docIds }, updatedAt: { $exists: false } },        // no timestamp yet — safe to insert
      ]
    };
    await Order.findOneAndUpdate(orderFilter, orderPayload, updateOpts);
  } else if (target === 'bills' || target === 'bill') {
    let paymentStatus = payload.paymentStatus;
    if (!paymentStatus) {
      const rawStatus = (payload.status || '').toLowerCase();
      paymentStatus = (rawStatus === 'paid' || rawStatus === 'completed' || rawStatus === 'settled') ? 'Paid' : (rawStatus === 'unpaid' ? 'Pending' : 'Paid');
    }
    const billPayload = {
      ...payload,
      billNumber: payload.billNumber || payload.bill_number || `BILL-${docId.slice(0, 8)}`,
      branchId: payload.branchId || payload.branch_id,
      orderId: payload.orderId || payload.order_id,
      subtotal: Number(payload.subtotal) || 0,
      cgst: Number(payload.cgst || (payload.tax ? payload.tax / 2 : 0)) || 0,
      sgst: Number(payload.sgst || (payload.tax ? payload.tax / 2 : 0)) || 0,
      grandTotal: Number(payload.grandTotal !== undefined ? payload.grandTotal : (payload.total !== undefined ? payload.total : payload.subtotal)) || 0,
      waiveOff: Number(payload.waiveOff !== undefined ? payload.waiveOff : (payload.discount || 0)) || 0,
      paymentStatus: paymentStatus,
      createdAt: createdAtDate,
      updatedAt: updatedAtDate,
    };
    // FIX #4: Timestamp guard — prevent a Pending bill from reverting a Paid bill.
    // Specifically blocks paymentStatus from downgrading Paid → Pending via stale event.
    const billFilter = {
      $or: [
        { _id: { $in: docIds }, updatedAt: { $lte: updatedAtDate } },
        { _id: { $in: docIds }, updatedAt: { $exists: false } },
      ]
    };
    await Bill.findOneAndUpdate(billFilter, billPayload, updateOpts);
  } else if (target === 'payments' || target === 'payment') {
    const cash = Number(payload.cash) || 0;
    const card = Number(payload.card) || 0;
    const upi = Number(payload.upi) || 0;
    const other = Number(payload.other) || 0;
    const payPayload = {
      ...payload,
      billId: payload.billId || payload.bill_id || docId,
      branchId: payload.branchId || payload.branch_id,
      orderId: payload.orderId || payload.order_id,
      cash,
      card,
      upi,
      other,
      totalPaid: Number(payload.totalPaid !== undefined ? payload.totalPaid : (payload.total !== undefined ? payload.total : (cash + card + upi + other))) || 0,
      createdAt: createdAtDate,
      updatedAt: updatedAtDate,
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
