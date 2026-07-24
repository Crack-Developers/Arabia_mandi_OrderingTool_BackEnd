import Table from '../models/Table';
import Branch from '../models/Branch';

export const tableService = {
  async getAll(branchId?: string) {
    const filter = branchId ? { branchId } : {};
    return Table.find(filter).sort({ tableNumber: 1 });
  },

  async getById(id: string) {
    const table = await Table.findById(id);
    if (!table) throw { statusCode: 404, message: 'Table not found.' };
    return table;
  },

  async create(data: any) {
    const table = new Table(data);
    return table.save();
  },

  async update(id: string, data: any) {
    const table = await Table.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!table) throw { statusCode: 404, message: 'Table not found.' };
    return table;
  },

  async delete(id: string) {
    const table = await Table.findById(id);
    if (!table) throw { statusCode: 404, message: 'Table not found.' };

    const branch = await Branch.findById(table.branchId);
    if (branch && branch.sections && table.sectionId) {
      const section = branch.sections.find(s => String(s._id) === String(table.sectionId));
      if (section && section.tablesCount) {
        section.tablesCount = Math.max(0, Number(section.tablesCount) - 1);
        await branch.save();
      }
    }

    await table.deleteOne();
    return table;
  },

  async updateStatus(id: string, status: string) {
    const table = await Table.findByIdAndUpdate(id, { status }, { new: true });
    if (!table) throw { statusCode: 404, message: 'Table not found.' };
    return table;
  },

  async reserve(id: string, customerName: string, phone: string, guests: number) {
    const table = await Table.findById(id);
    if (!table) throw { statusCode: 404, message: 'Table not found.' };
    if (table.status !== 'Available') throw { statusCode: 400, message: 'Table is not available for reservation.' };

    const now = new Date();
    const expiry = new Date(now.getTime() + 20 * 60 * 1000);

    table.status = 'Reserved';
    table.reservation = {
      customerName,
      phone,
      reservedAt: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      expiresAt: expiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      guests,
    };
    return table.save();
  },

  async cancelReservation(id: string) {
    const table = await Table.findById(id);
    if (!table) throw { statusCode: 404, message: 'Table not found.' };

    table.status = 'Available';
    table.reservation = undefined;
    return table.save();
  },

  async merge(primaryId: string, targetId: string) {
    const primary = await Table.findById(primaryId);
    const target = await Table.findById(targetId);
    if (!primary || !target) throw { statusCode: 404, message: 'One or both tables not found.' };

    const mergedNames = primary.mergedWith
      ? [...primary.mergedWith, target.tableNumber]
      : [target.tableNumber];

    primary.mergedWith = mergedNames;
    target.status = 'Merged';

    await primary.save();
    await target.save();
    return { primary, target };
  },

  async separate(id: string) {
    const primary = await Table.findById(id);
    if (!primary) throw { statusCode: 404, message: 'Table not found.' };

    if (primary.mergedWith && primary.mergedWith.length > 0) {
      await Table.updateMany(
        { branchId: primary.branchId, tableNumber: { $in: primary.mergedWith } },
        { status: 'Available' }
      );
    }

    primary.mergedWith = undefined;
    return primary.save();
  },

  async release(id: string) {
    const table = await Table.findById(id);
    if (!table) throw { statusCode: 404, message: 'Table not found.' };

    table.status = 'Available';
    table.currentOrderId = undefined;
    table.reservation = undefined;
    table.occupiedSince = undefined;
    table.mergedWith = undefined;
    return table.save();
  },
};
