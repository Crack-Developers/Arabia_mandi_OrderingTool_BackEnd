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

export const syncService = {
  async upload(items: any[]) {
    const results = [];
    for (const item of items) {
      // 1. Log to SyncQueue
      const syncItem = new SyncQueue(item);
      const saved = await syncItem.save();
      results.push(saved);

      // 2. Apply directly to MongoDB Target Collection
      try {
        await applySyncItemToDb(item);
        saved.synced = true;
        await saved.save();
      } catch (applyErr: any) {
        console.warn(`[SyncService] Could not apply item ${item.recordId || item._id} to collection ${item.table || item.entity}:`, applyErr.message);
      }
    }
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
};

async function applySyncItemToDb(item: any) {
  const target = (item.table || item.entity || '').toLowerCase();
  const action = (item.action || item.operation || '').toUpperCase();
  const payload = item.payload;
  if (!payload) return;

  const docId = payload._id || item.recordId;
  if (!docId) return;

  if (action === 'DELETE') {
    if (target === 'orders' || target === 'order') await Order.deleteOne({ _id: docId });
    else if (target === 'bills' || target === 'bill') await Bill.deleteOne({ _id: docId });
    else if (target === 'payments' || target === 'payment') await Payment.deleteOne({ _id: docId });
    else if (target === 'tables' || target === 'table') {
      const table = await Table.findById(docId);
      if (table) {
        const branch = await Branch.findById(table.branchId);
        if (branch && branch.sections && table.sectionId) {
          const section = branch.sections.find((s: any) => String(s._id) === String(table.sectionId));
          if (section && section.tablesCount) {
            section.tablesCount = Math.max(0, Number(section.tablesCount) - 1);
            await branch.save();
          }
        }
        await table.deleteOne();
      }
    }
    else if (target === 'menu_items' || target === 'menuitem') await MenuItem.deleteOne({ _id: docId });
    else if (target === 'categories' || target === 'category') await Category.deleteOne({ _id: docId });
    else if (target === 'printers' || target === 'printer') await Printer.deleteOne({ _id: docId });
    else if (target === 'sections' || target === 'section') await Section.deleteOne({ _id: docId });
    return;
  }

  // INSERT, UPDATE, CREATE
  const updateOpts = { upsert: true, new: true, setDefaultsOnInsert: true };
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
  } else if (target === 'tables' || target === 'table') {
    await Table.findOneAndUpdate({ _id: docId }, payload, updateOpts);
  } else if (target === 'menu_items' || target === 'menuitem') {
    await MenuItem.findOneAndUpdate({ _id: docId }, payload, updateOpts);
  } else if (target === 'categories' || target === 'category') {
    await Category.findOneAndUpdate({ _id: docId }, payload, updateOpts);
  } else if (target === 'printers' || target === 'printer') {
    await Printer.findOneAndUpdate({ _id: docId }, payload, updateOpts);
  } else if (target === 'sections' || target === 'section') {
    await Section.findOneAndUpdate({ _id: docId }, payload, updateOpts);
  }
}
