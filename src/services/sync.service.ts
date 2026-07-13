import SyncQueue from '../models/SyncQueue';

export const syncService = {
  async upload(items: any[]) {
    const results = [];
    for (const item of items) {
      const syncItem = new SyncQueue(item);
      const saved = await syncItem.save();
      results.push(saved);
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
