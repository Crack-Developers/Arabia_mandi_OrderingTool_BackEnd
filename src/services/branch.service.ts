import Branch from '../models/Branch';
import { branchDbService } from './branchDb.service';

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
    await branch.save();
    // Immediately initialize dedicated database and tables for the new branch
    await branchDbService.ensureBranchDatabase(branch);
    return branch;
  },

  async update(id: string, data: any) {
    const updatePayload = { ...data };
    delete updatePayload._id;
    delete updatePayload.__v;
    delete updatePayload.createdAt;
    delete updatePayload.updatedAt;
    const branch = await Branch.findByIdAndUpdate(id, updatePayload, { new: true, runValidators: true });
    if (!branch) throw { statusCode: 404, message: 'Branch not found.' };
    await branchDbService.ensureBranchDatabase(branch);
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
