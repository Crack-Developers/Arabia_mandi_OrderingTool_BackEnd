import Bill from '../models/Bill';

export const billService = {
  async getAll(branchId?: string) {
    const filter = branchId ? { branchId } : {};
    return Bill.find(filter).sort({ createdAt: -1 });
  },

  async getById(id: string) {
    const bill = await Bill.findById(id);
    if (!bill) throw { statusCode: 404, message: 'Bill not found.' };
    return bill;
  },
};
