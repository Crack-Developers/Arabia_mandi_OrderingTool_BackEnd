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
    const updatePayload = { ...data };
    delete updatePayload._id;
    delete updatePayload.__v;
    delete updatePayload.createdAt;
    delete updatePayload.updatedAt;
    delete updatePayload.employeeCode;
    // If password is being updated and not already hashed, hash it
    if (updatePayload.password && updatePayload.password.trim() !== '') {
      if (!updatePayload.password.startsWith('$2a$') && !updatePayload.password.startsWith('$2b$')) {
        updatePayload.password = await bcrypt.hash(updatePayload.password, 12);
      }
    } else {
      delete updatePayload.password;
    }
    const staff = await Staff.findByIdAndUpdate(id, updatePayload, { new: true, runValidators: true }).select('-password');
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

  async getQRPayload(id: string, query?: any) {
    let staff = await Staff.findById(id).catch(() => null);
    if (!staff && query && query.username) {
      staff = await Staff.findOne({ username: query.username }).catch(() => null);
    }
    
    const secret = process.env.JWT_SECRET || 'fallback_secret';
    const jwt = require('jsonwebtoken');

    if (!staff) {
      if (query && query.name) {
        const token = jwt.sign(
          { _id: id, staffId: id, branchId: query.branchId || '', role: query.role || 'Waiter', username: query.username || query.name, name: query.name, branchAccess: 'Single Branch' },
          secret
        );
        return {
          serverIp: query.serverIp || '192.168.137.64:3001',
          branchId: query.branchId || '',
          username: query.username || query.name,
          role: query.role || 'Waiter',
          name: query.name,
          token,
          pin: query.pin || '1234',
          assignedSections: ['ALL'],
        };
      }
      throw { statusCode: 404, message: 'Staff member not found.' };
    }

    if (!staff.active) throw { statusCode: 400, message: 'Staff account is deactivated.' };

    const token = jwt.sign(
      { _id: staff._id, staffId: staff._id, id: staff._id, branchId: staff.branchId, role: staff.role, username: staff.username, name: staff.name, branchAccess: staff.branchAccess || 'Single Branch' },
      secret
    );

    return {
      serverIp: query?.serverIp || '192.168.137.64:3001',
      branchId: staff.branchId,
      username: staff.username,
      role: staff.role,
      name: staff.name,
      token,
      pin: '1234',
      assignedSections: ['ALL'],
    };
  },
};
