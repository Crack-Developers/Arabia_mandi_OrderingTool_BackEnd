import Notification from '../models/Notification';

export const notificationService = {
  async getAll(branchId?: string) {
    const filter = branchId ? { $or: [{ branchId }, { branchId: { $exists: false } }] } : {};
    return Notification.find(filter).sort({ createdAt: -1 }).limit(50);
  },

  async create(data: any) {
    const notification = new Notification(data);
    return notification.save();
  },

  async markRead(id: string) {
    const notification = await Notification.findByIdAndUpdate(id, { read: true }, { new: true });
    if (!notification) throw { statusCode: 404, message: 'Notification not found.' };
    return notification;
  },

  async delete(id: string) {
    const notification = await Notification.findByIdAndDelete(id);
    if (!notification) throw { statusCode: 404, message: 'Notification not found.' };
    return notification;
  },
};
