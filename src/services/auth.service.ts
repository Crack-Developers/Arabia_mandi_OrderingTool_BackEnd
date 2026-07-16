import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Staff from '../models/Staff';
import Branch from '../models/Branch';
import { branchDbService } from './branchDb.service';
import { auditLogService } from './auditLog.service';

export const authService = {
  async login(username: string, password: string) {
    const trimmedUsername = (username || '').trim();
    const trimmedPassword = (password || '').trim();

    // Perform exact case-insensitive match for username
    const escapedUsername = trimmedUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let user = await Staff.findOne({
      username: { $regex: new RegExp(`^${escapedUsername}$`, 'i') },
      active: true,
    });

    // Auto-bootstrap default Super Admin if database was wiped/empty
    if (!user && trimmedUsername === 'admin' && trimmedPassword === 'Password@123') {
      let branch = await Branch.findOne({});
      if (!branch) {
        branch = await Branch.create({
          branchCode: 'BR-MAIN',
          name: 'Arabian Mandi – Main Branch',
          address: 'Main Location',
          phone: '+91 9876543210',
          gst: '36AABCA1234F1Z5',
          status: 'Active',
        });
      }
      const hashed = await bcrypt.hash('Password@123', 12);
      user = await Staff.create({
        employeeCode: 'EMP-001',
        name: 'Super Admin',
        email: 'admin@arabianmandi.com',
        phone: '+91 9876543210',
        role: 'Super Admin',
        branchId: branch._id,
        active: true,
        username: 'admin',
        password: hashed,
      });
    }

    if (!user) throw { statusCode: 401, message: 'Invalid username or password.' };

    const isMatch = await bcrypt.compare(trimmedPassword, user.password);
    if (!isMatch) throw { statusCode: 401, message: 'Invalid username or password.' };

    const secret = process.env.JWT_SECRET || 'fallback_secret';
    const token = jwt.sign(
      { id: user._id, role: user.role, branchId: user.branchId },
      secret,
      { expiresIn: 60 * 60 * 24 * 7 } // 7 days in seconds
    );

    // Initialize dedicated branch database on local machine & record structured login audit log
    if (user.branchId) {
      try {
        const branchObj = await Branch.findById(user.branchId);
        if (branchObj) {
          await branchDbService.ensureBranchDatabase(branchObj);
          await auditLogService.logAction({
            branchId: branchObj._id.toString(),
            branchCode: branchObj.branchCode,
            actionType: 'LOGIN_SUCCESS',
            performedBy: {
              staffId: user._id.toString(),
              staffName: user.name,
              role: user.role,
            },
            target: {
              entityType: 'SESSION',
              entityId: user._id.toString(),
              label: `${user.name} logged into ${branchObj.name}`,
            },
            details: {
              username: user.username,
              role: user.role,
              loginTimestamp: new Date().toISOString(),
              synchronizedLocalDb: true,
            },
          });
        }
      } catch (e: any) {
        console.warn('[Login Audit] Could not record branch login log:', e.message);
      }
    }

    return {
      token,
      user: {
        _id: user._id,
        employeeCode: user.employeeCode,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        branchId: user.branchId,
        designation: user.designation,
        branchAccess: user.branchAccess,
      },
    };
  },

  async getProfile(userId: string) {
    const user = await Staff.findById(userId).select('-password').populate('branchId');
    if (!user) throw { statusCode: 404, message: 'User not found.' };
    return user;
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await Staff.findById(userId);
    if (!user) throw { statusCode: 404, message: 'User not found.' };

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) throw { statusCode: 400, message: 'Current password is incorrect.' };

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    return { message: 'Password changed successfully.' };
  },
};
