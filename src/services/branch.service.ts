import Branch from '../models/Branch';

export const branchService = {
  async getAll() {
    return Branch.find().sort({ createdAt: -1 });
  },

  async getById(id: string) {
    const branch = await Branch.findById(id);
    if (!branch) throw { statusCode: 404, message: 'Branch not found.' };
    return branch;
  },

  async create(data: any) {
    const branch = new Branch(data);
    return branch.save();
  },

  async update(id: string, data: any) {
    const branch = await Branch.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!branch) throw { statusCode: 404, message: 'Branch not found.' };
    return branch;
  },

  async delete(id: string) {
    const count = await Branch.countDocuments();
    if (count <= 1) throw { statusCode: 400, message: 'Cannot delete. At least one branch must remain.' };

    const branch = await Branch.findByIdAndDelete(id);
    if (!branch) throw { statusCode: 404, message: 'Branch not found.' };
    return branch;
  },

  async toggleStatus(id: string) {
    const branch = await Branch.findById(id);
    if (!branch) throw { statusCode: 404, message: 'Branch not found.' };

    branch.status = branch.status === 'Active' ? 'Inactive' : 'Active';
    return branch.save();
  },
};
