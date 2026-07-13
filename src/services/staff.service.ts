import bcrypt from 'bcryptjs';
import Staff from '../models/Staff';

export const staffService = {
  async getAll(branchId?: string) {
    const filter = branchId ? { branchId } : {};
    return Staff.find(filter).select('-password').sort({ createdAt: -1 });
  },

  async getById(id: string) {
    const staff = await Staff.findById(id).select('-password');
    if (!staff) throw { statusCode: 404, message: 'Staff member not found.' };
    return staff;
  },

  async create(data: any) {
    // Hash the password before saving
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 12);
    }
    const staff = new Staff(data);
    return staff.save();
  },

  async update(id: string, data: any) {
    // If password is being updated, hash it
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 12);
    }
    const staff = await Staff.findByIdAndUpdate(id, data, { new: true, runValidators: true }).select('-password');
    if (!staff) throw { statusCode: 404, message: 'Staff member not found.' };
    return staff;
  },

  async delete(id: string) {
    const staff = await Staff.findByIdAndDelete(id);
    if (!staff) throw { statusCode: 404, message: 'Staff member not found.' };
    return staff;
  },

  async resetPassword(id: string) {
    const staff = await Staff.findById(id);
    if (!staff) throw { statusCode: 404, message: 'Staff member not found.' };

    const randomChars = Math.random().toString(36).slice(-4).toUpperCase();
    const newPassword = `AM-2026#${randomChars}`;
    staff.password = await bcrypt.hash(newPassword, 12);
    await staff.save();

    return { newPassword, message: `Password reset for ${staff.name}` };
  },
};
