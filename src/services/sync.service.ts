import SyncQueue from '../models/SyncQueue';
import Order from '../models/Order';
import Bill from '../models/Bill';
import Payment from '../models/Payment';
import Table from '../models/Table';
import MenuItem from '../models/MenuItem';

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
    else if (target === 'tables' || target === 'table') await Table.deleteOne({ _id: docId });
    else if (target === 'menu_items' || target === 'menuitem') await MenuItem.deleteOne({ _id: docId });
    return;
  }

  // INSERT, UPDATE, CREATE
  const updateOpts = { upsert: true, new: true, setDefaultsOnInsert: true };
  if (target === 'orders' || target === 'order') {
    await Order.findOneAndUpdate({ _id: docId }, payload, updateOpts);
  } else if (target === 'bills' || target === 'bill') {
    await Bill.findOneAndUpdate({ _id: docId }, payload, updateOpts);
  } else if (target === 'payments' || target === 'payment') {
    await Payment.findOneAndUpdate({ _id: docId }, payload, updateOpts);
  } else if (target === 'tables' || target === 'table') {
    await Table.findOneAndUpdate({ _id: docId }, payload, updateOpts);
  } else if (target === 'menu_items' || target === 'menuitem') {
    await MenuItem.findOneAndUpdate({ _id: docId }, payload, updateOpts);
  }
}
