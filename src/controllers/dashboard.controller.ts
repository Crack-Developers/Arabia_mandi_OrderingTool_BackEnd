import { Request, Response, NextFunction } from 'express';
import Order from '../models/Order';
import Bill from '../models/Bill';
import Payment from '../models/Payment';
import Branch from '../models/Branch';
import Staff from '../models/Staff';
import Table from '../models/Table';

export const dashboardController = {
  async getAdminStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const totalBranches = await Branch.countDocuments();
      const activeBranches = await Branch.countDocuments({ status: 'Active' });
      const totalStaff = await Staff.countDocuments({ active: true });
      const totalTables = await Table.countDocuments();
      const totalOrders = await Order.countDocuments();
      const activeOrders = await Order.countDocuments({ status: 'Active' });
      const completedOrders = await Order.countDocuments({ status: 'Completed' });
      const totalBills = await Bill.countDocuments();
      const paidBills = await Bill.countDocuments({ paymentStatus: 'Paid' });
      const pendingBills = await Bill.countDocuments({ paymentStatus: 'Pending' });

      // Revenue calculation
      const revenueAgg = await Payment.aggregate([
        { $group: { _id: null, totalRevenue: { $sum: '$totalPaid' } } },
      ]);
      const totalRevenue = revenueAgg[0]?.totalRevenue || 0;

      res.json({
        success: true,
        data: {
          totalBranches, activeBranches, totalStaff, totalTables,
          totalOrders, activeOrders, completedOrders,
          totalBills, paidBills, pendingBills, totalRevenue,
        },
      });
    } catch (err) { next(err); }
  },
};
