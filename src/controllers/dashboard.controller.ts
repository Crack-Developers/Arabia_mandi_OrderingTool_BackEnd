/**
 * dashboard.controller.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Aggregation-based analytics controller for the Admin Dashboard.
 *
 * Architecture:
 *   - Receptionist POS → stores data in LOCAL MongoDB
 *   - Atlas Sync pushes that data to Cloud MongoDB (Atlas)
 *   - This controller runs aggregations on whatever DB is primary (local or Atlas)
 *
 * Endpoint: GET /api/v1/dashboard/stats?date=2026-07-14&branchId=xxx
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order';
import Bill from '../models/Bill';
import Payment from '../models/Payment';
import Branch from '../models/Branch';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDayRange(dateStr?: string): { start: Date; end: Date } {
  const base = dateStr ? new Date(dateStr) : new Date();
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getTimeRangeForFilter(req: Request): { start: Date; end: Date; label: string } {
  const { filterType = 'day', date, month, year } = req.query as Record<string, string>;
  const now = new Date();

  if (filterType === 'month') {
    let y = now.getFullYear();
    let m = now.getMonth();
    if (month && month.includes('-')) {
      const parts = month.split('-');
      y = parseInt(parts[0], 10) || y;
      m = (parseInt(parts[1], 10) || (m + 1)) - 1;
    }
    const start = new Date(y, m, 1, 0, 0, 0, 0);
    const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
    const label = start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    return { start, end, label };
  } else if (filterType === 'year') {
    const y = parseInt(year || String(now.getFullYear()), 10) || now.getFullYear();
    const start = new Date(y, 0, 1, 0, 0, 0, 0);
    const end = new Date(y, 11, 31, 23, 59, 59, 999);
    const label = `Year ${y}`;
    return { start, end, label };
  } else if (filterType === 'week') {
    const base = date ? new Date(date) : now;
    const dayOfWeek = base.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const start = new Date(base);
    start.setDate(base.getDate() + diffToMonday);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    const label = `${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} - ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    return { start, end, label };
  } else {
    const base = date ? new Date(date) : now;
    const start = new Date(base);
    start.setHours(0, 0, 0, 0);
    const end = new Date(base);
    end.setHours(23, 59, 59, 999);
    const label = start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return { start, end, label };
  }
}

async function toBranchFilter(branchId?: string) {
  if (!branchId || branchId === 'ALL') {
    return {};
  }
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(String(branchId || ''));
  if (isValidObjectId) {
    const oid = new mongoose.Types.ObjectId(branchId);
    return { $or: [{ branchId: oid }, { branchId: String(branchId) }] };
  }
  try {
    const branch = await Branch.findOne({ $or: [{ branchCode: branchId }, { name: branchId }] });
    if (branch) {
      return { $or: [{ branchId: branch._id }, { branchId: String(branch._id) }, { branchId }] };
    }
  } catch {
    // fallback
  }
  return { branchId };
}

// Map any 0–23 hour into one of six 4-hour display buckets
function hourToBucket(hour: number): number {
  if (hour >= 1  && hour < 5)  return 0; // 01:00am – 05:00am
  if (hour >= 5  && hour < 9)  return 1; // 05:00am – 09:00am
  if (hour >= 9  && hour < 13) return 2; // 09:00am – 01:00pm
  if (hour >= 13 && hour < 17) return 3; // 01:00pm – 05:00pm
  if (hour >= 17 && hour < 21) return 4; // 05:00pm – 09:00pm
  return 5;                               // 09:00pm – 01:00am  (21–24 + 0)
}

const HOURLY_BUCKETS = [
  { label: '01:00am - 05:00am', revenue: 0 },
  { label: '05:00am - 09:00am', revenue: 0 },
  { label: '09:00am - 01:00pm', revenue: 0 },
  { label: '01:00pm - 05:00pm', revenue: 0 },
  { label: '05:00pm - 09:00pm', revenue: 0 },
  { label: '09:00pm - 01:00am', revenue: 0 },
];

// ─── Controller ──────────────────────────────────────────────────────────────

export const dashboardController = {

  /** Legacy simple stats (kept for backward compat) */
  async getAdminStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const totalOrders  = await Order.countDocuments();
      const activeOrders = await Order.countDocuments({ status: 'Active' });
      const totalBills   = await Bill.countDocuments();
      const paidBills    = await Bill.countDocuments({ paymentStatus: 'Paid' });
      const revenueAgg   = await Payment.aggregate([
        { $group: { _id: null, total: { $sum: '$totalPaid' } } },
      ]);
      res.json({
        success: true,
        data: { totalOrders, activeOrders, totalBills, paidBills, totalRevenue: revenueAgg[0]?.total || 0 },
      });
    } catch (err) { next(err); }
  },

  /**
   * GET /api/v1/dashboard/leakage-logs
   * Fetches the detailed logs for a specific leakage type
   */
  async getLeakageLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const { date, branchId, type } = req.query as Record<string, string>;
      const { start, end } = getTimeRangeForFilter(req);
      const branchFilter = await toBranchFilter(branchId);
      const dateFilter = { createdAt: { $gte: start, $lte: end } };
      
      const orderMatch = { ...dateFilter, ...branchFilter };
      const billMatch = { ...dateFilter, ...branchFilter };

      let data: any[] = [];

      switch (type) {
        case 'kotsCancelled':
          data = await Order.find({ ...orderMatch, 'kots.status': 'Cancelled' })
            .select('orderNumber tableNumber kots items createdAt updatedAt status branchId')
            .lean();
          break;
        case 'kotsModified':
          data = await Order.find({ ...orderMatch, 'kots.status': 'Modified' })
            .select('orderNumber tableNumber kots items createdAt updatedAt status branchId')
            .lean();
          break;
        case 'kotsNotInBills':
          data = await Order.find({
            ...orderMatch,
            'kots.0': { $exists: true },
            status: 'Active',           // Only Active = genuine unbilled leakage; Cancelled = intentional
            total: { $gt: 0 },          // Exclude zero-total ghost orders
          }).select('orderNumber tableNumber kots items createdAt updatedAt status branchId').lean();
          break;
        case 'kotsShifted':
          data = await Order.find({ ...orderMatch, tableShiftCount: { $gt: 0 } })
            .select('orderNumber tableNumber tableShiftCount items createdAt updatedAt status branchId')
            .lean();
          break;
        case 'billsModified':
          data = await Bill.find({ ...billMatch, billModified: true })
            .select('billNumber tableNumber grandTotal createdAt waiveOff billModified branchId orderId')
            .populate({ path: 'orderId', select: 'orderNumber items kots' })
            .lean();
          break;
        case 'billsReprinted':
          data = await Bill.find({ ...billMatch, reprintCount: { $gt: 0 } })
            .select('billNumber tableNumber grandTotal reprintCount createdAt branchId')
            .lean();
          break;
        case 'waivedOff':
          data = await Bill.find({ ...billMatch, waiveOff: { $gt: 0 } })
            .select('billNumber tableNumber grandTotal waiveOff createdAt branchId')
            .lean();
          break;
        default:
          return res.status(400).json({ success: false, message: 'Invalid leakage type' });
      }

      const allBranches = await Branch.find({}).select('name branchCode').lean();
      const branchMap: Record<string, { name: string; branchCode: string }> = {};
      allBranches.forEach((b: any) => {
        if (b._id) branchMap[String(b._id)] = { name: b.name || '', branchCode: b.branchCode || '' };
        if (b.branchCode) branchMap[b.branchCode] = { name: b.name || '', branchCode: b.branchCode || '' };
      });

      const enrichedData = data.map((item: any) => {
        const bKey = String(item.branchId || '');
        const bInfo = branchMap[bKey] || { name: item.branchName || '', branchCode: item.branchCode || '' };
        return {
          ...item,
          branchName: bInfo.name,
          branchCode: bInfo.branchCode,
        };
      });

      res.json({ success: true, data: enrichedData });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/dashboard/stats
   * Full dashboard analytics aggregation
   */
  async getDashboardStats(req: Request, res: Response, next: NextFunction) {
    try {
      const { date, branchId, filterType = 'day' } = req.query as Record<string, string>;

      const { start, end, label } = getTimeRangeForFilter(req);
      const branchFilter    = await toBranchFilter(branchId);
      const dateFilter      = { createdAt: { $gte: start, $lte: end } };
      const orderMatch      = { ...dateFilter, ...branchFilter };
      const billMatch       = { ...dateFilter, ...branchFilter };
      const paymentMatch    = { ...dateFilter, ...branchFilter };

      // ── Run ALL aggregations in parallel for speed ──────────────────────────
      const [
        billAgg,
        paymentAgg,
        orderAgg,
        hourlyAgg,
        orderTypeAgg,
        itemAgg,
        kotAgg,
        kotsNotInBills,
      ] = await Promise.all([

        // 1. Bill-level stats: totalSales, notPaid, waiveOff, modified, reprinted
        Bill.aggregate([
          { $match: billMatch },
          { $group: {
            _id: null,
            totalSales:    { $sum: { $cond: [{ $eq: ['$paymentStatus', 'Paid'] },    '$grandTotal', 0] } },
            notPaid:       { $sum: { $cond: [{ $eq: ['$paymentStatus', 'Pending'] }, '$grandTotal', 0] } },
            waivedOff:     { $sum: '$waiveOff' },
            billsModified: { $sum: { $cond: ['$billModified', 1, 0] } },
            billsReprinted:{ $sum: { $cond: [{ $gt: ['$reprintCount', 0] }, 1, 0] } },
          }},
        ]),

        // 2. Payment breakdown: cash, card, upi, other
        Payment.aggregate([
          { $match: paymentMatch },
          { $group: {
            _id: null,
            cash:  { $sum: '$cash' },
            card:  { $sum: '$card' },
            upi:   { $sum: '$upi' },
            other: { $sum: '$other' },
          }},
        ]),

        // 3. Order counts: total, successful, cancelled
        Order.aggregate([
          { $match: orderMatch },
          { $group: {
            _id: null,
            total:     { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] } },
          }},
        ]),

        // 4. Time-series paid-bill revenue (group by hour/date/month depending on filter)
        Bill.aggregate([
          { $match: { ...billMatch, paymentStatus: 'Paid' } },
          { $group: {
            _id: {
              hour: { $hour: { date: '$createdAt', timezone: '+05:30' } },
              date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:30' } },
              dayOfMonth: { $dayOfMonth: { date: '$createdAt', timezone: '+05:30' } },
              month: { $month: { date: '$createdAt', timezone: '+05:30' } },
            },
            revenue: { $sum: '$grandTotal' },
          }},
        ]),

        // 5. Order type split: DineIn / PickUp / Delivery (only completed/paid orders)
        Order.aggregate([
          { $match: { ...orderMatch, status: 'Completed' } },
          { $group: {
            _id:     { $ifNull: ['$orderType', 'DineIn'] },
            count:   { $sum: 1 },
            revenue: { $sum: '$total' },
            avgTTA:  { $avg: {
              $cond: [
                { $and: [{ $ifNull: ['$completedAt', false] }, { $ifNull: ['$createdAt', false] }] },
                { $divide: [{ $subtract: ['$completedAt', '$createdAt'] }, 60000] }, // → minutes
                null,
              ],
            }},
          }},
        ]),

        // 6. Item performance: unwind order items, group by item name (only completed/paid orders)
        Order.aggregate([
          { $match: { ...orderMatch, status: 'Completed' } },
          { $unwind: '$items' },
          { $group: {
            _id:     '$items.name',
            qtySold: { $sum: '$items.quantity' },
            revenue: { $sum: { $multiply: [{ $ifNull: ['$items.price', 0] }, { $ifNull: ['$items.quantity', 0] }] } },
          }},
          { $sort: { qtySold: -1 } },
          { $limit: 50 },
        ]),

        // 7. KOT leakage: cancelled & modified KOTs
        Order.aggregate([
          { $match: orderMatch },
          { $unwind: { path: '$kots', preserveNullAndEmptyArrays: false } },
          { $group: {
            _id: null,
            kotsCancelled: { $sum: { $cond: [{ $eq: ['$kots.status', 'Cancelled'] }, 1, 0] } },
            kotsModified:  { $sum: { $cond: [{ $eq: ['$kots.status', 'Modified']  }, 1, 0] } },
            kotsShifted:   { $sum: '$tableShiftCount' },
          }},
        ]),

        // 8. KOTs not used in bills = Active orders with KOTs that have not been paid
        //    Excludes Cancelled (intentional) and zero-total ghost orders.
        Order.countDocuments({
          ...orderMatch,
          'kots.0': { $exists: true },
          status: 'Active',
          total: { $gt: 0 },
        }),
      ]);

      // ── Post-process chart data based on filterType ─────────────────────────
      const hourlySales: { label: string; revenue: number }[] = [];
      if (filterType === 'week') {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const tempSlots: { label: string; revenue: number; dateStr: string }[] = [];
        for (let i = 0; i < 7; i++) {
          const cur = new Date(start);
          cur.setDate(start.getDate() + i);
          const y = cur.getFullYear();
          const m = String(cur.getMonth() + 1).padStart(2, '0');
          const d = String(cur.getDate()).padStart(2, '0');
          const dateStr = `${y}-${m}-${d}`;
          const dayName = dayNames[cur.getDay()];
          const dayLabel = cur.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
          tempSlots.push({ label: `${dayName} - ${dayLabel}`, revenue: 0, dateStr });
        }
        (hourlyAgg as any[]).forEach(({ _id, revenue }) => {
          if (_id && _id.date) {
            const found = tempSlots.find((s) => s.dateStr === _id.date);
            if (found) found.revenue += revenue;
          }
        });
        tempSlots.forEach((s) => hourlySales.push({ label: s.label, revenue: s.revenue }));
      } else if (filterType === 'month') {
        const slots = [
          { label: '1st - 5th - Week 1', revenue: 0, minDay: 1, maxDay: 5 },
          { label: '6th - 10th - Week 2', revenue: 0, minDay: 6, maxDay: 10 },
          { label: '11th - 15th - Week 3', revenue: 0, minDay: 11, maxDay: 15 },
          { label: '16th - 20th - Week 4', revenue: 0, minDay: 16, maxDay: 20 },
          { label: '21st - 25th - Week 5', revenue: 0, minDay: 21, maxDay: 25 },
          { label: '26th - End - Week 6', revenue: 0, minDay: 26, maxDay: 31 },
        ];
        (hourlyAgg as any[]).forEach(({ _id, revenue }) => {
          if (_id && typeof _id.dayOfMonth === 'number') {
            const slot = slots.find((s) => _id.dayOfMonth >= s.minDay && _id.dayOfMonth <= s.maxDay);
            if (slot) slot.revenue += revenue;
          }
        });
        slots.forEach((s) => hourlySales.push({ label: s.label, revenue: s.revenue }));
      } else if (filterType === 'year') {
        const months = [
          { monthNum: 1, label: 'Jan - Q1' },
          { monthNum: 2, label: 'Feb - Q1' },
          { monthNum: 3, label: 'Mar - Q1' },
          { monthNum: 4, label: 'Apr - Q2' },
          { monthNum: 5, label: 'May - Q2' },
          { monthNum: 6, label: 'Jun - Q2' },
          { monthNum: 7, label: 'Jul - Q3' },
          { monthNum: 8, label: 'Aug - Q3' },
          { monthNum: 9, label: 'Sep - Q3' },
          { monthNum: 10, label: 'Oct - Q4' },
          { monthNum: 11, label: 'Nov - Q4' },
          { monthNum: 12, label: 'Dec - Q4' },
        ];
        months.forEach((m) => {
          let totalRev = 0;
          (hourlyAgg as any[]).forEach(({ _id, revenue }) => {
            if (_id && _id.month === m.monthNum) {
              totalRev += revenue;
            }
          });
          hourlySales.push({ label: m.label, revenue: totalRev });
        });
      } else {
        HOURLY_BUCKETS.forEach((b) => hourlySales.push({ ...b }));
        (hourlyAgg as any[]).forEach(({ _id, revenue }) => {
          if (_id && typeof _id.hour === 'number') {
            hourlySales[hourToBucket(_id.hour)].revenue += revenue;
          } else if (typeof _id === 'number') {
            hourlySales[hourToBucket(_id)].revenue += revenue;
          }
        });
      }

      // ── Post-process order types ────────────────────────────────────────────
      const orderTypeMap: Record<string, { count: number; revenue: number; avgTurnAroundMins: number }> = {
        DineIn:   { count: 0, revenue: 0, avgTurnAroundMins: 0 },
        PickUp:   { count: 0, revenue: 0, avgTurnAroundMins: 0 },
        Delivery: { count: 0, revenue: 0, avgTurnAroundMins: 0 },
      };
      (orderTypeAgg as any[]).forEach(({ _id, count, revenue, avgTTA }) => {
        const key = _id || 'DineIn';
        if (orderTypeMap[key]) {
          orderTypeMap[key].count   += count;
          orderTypeMap[key].revenue += revenue;
          if (avgTTA) {
            orderTypeMap[key].avgTurnAroundMins = Math.round(avgTTA * 10) / 10;
          }
        }
      });

      // ── Shape final response ────────────────────────────────────────────────
      const b  = (billAgg    as any[])[0] || {};
      const p  = (paymentAgg as any[])[0] || {};
      const o  = (orderAgg   as any[])[0] || {};
      const kl = (kotAgg     as any[])[0] || {};

      const topItems = (itemAgg as any[]).slice(0, 10).map((i) => ({
        name: i._id, qtySold: i.qtySold, revenue: i.revenue,
      }));
      const lowItems = (itemAgg as any[]).slice(-10).reverse().map((i) => ({
        name: i._id, qtySold: i.qtySold, revenue: i.revenue,
      }));

      res.json({
        success: true,
        data: {
          date: label || date || new Date().toISOString().split('T')[0],
          salesStats: {
            totalSales:    b.totalSales  || 0,
            notPaid:       b.notPaid     || 0,
            cash:          p.cash        || 0,
            card:          p.card        || 0,
            online:        p.upi         || 0,
            other:         p.other       || 0,
            totalOrders:   o.total       || 0,
            successful:    o.completed   || 0,
            cancelled:     o.cancelled   || 0,
            complementary: 0,
            hourlySales,
          },
          orderTypes: {
            dineIn:   orderTypeMap.DineIn,
            pickUp:   orderTypeMap.PickUp,
            delivery: orderTypeMap.Delivery,
          },
          leakage: {
            kotsCancelled:  kl.kotsCancelled  || 0,
            kotsModified:   kl.kotsModified   || 0,
            kotsNotInBills: kotsNotInBills     || 0,
            kotsShifted:    kl.kotsShifted     || 0,
            billsModified:  b.billsModified    || 0,
            billsReprinted: b.billsReprinted   || 0,
            waivedOff:      b.waivedOff        || 0,
          },
          itemPerformance: { top: topItems, low: lowItems },
          expensesWithdrawals: { total: 0 },
          lastUpdated: new Date().toISOString(),
        },
      });
    } catch (err) { next(err); }
  },

  /**
   * GET /api/v1/dashboard/dish-summary
   * Item sales summary filtered by day, month, or year
   */
  async getDishSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const { branchId, category } = req.query as Record<string, string>;
      const { start, end, label } = getTimeRangeForFilter(req);
      const branchFilter = await toBranchFilter(branchId);

      const orderMatch: any = {
        createdAt: { $gte: start, $lte: end },
        status: 'Completed',          // Only paid/completed orders = actual sales
        ...branchFilter,
      };

      const aggPipeline: any[] = [
        { $match: orderMatch },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'menuitems',
            localField: 'items.menuItemId',
            foreignField: '_id',
            as: 'menuItemData',
          },
        },
        {
          $lookup: {
            from: 'categories',
            localField: 'menuItemData.0.categoryId',
            foreignField: '_id',
            as: 'categoryData',
          },
        },
        {
          $addFields: {
            resolvedCategory: {
              $ifNull: [{ $arrayElemAt: ['$categoryData.name', 0] }, 'General Menu'],
            },
          },
        },
      ];

      if (category && category !== 'ALL') {
        aggPipeline.push({
          $match: { resolvedCategory: category },
        });
      }

      aggPipeline.push(
        {
          $group: {
            _id: {
              name: '$items.name',
              variantName: { $ifNull: ['$items.variantName', 'Standard'] },
              category: '$resolvedCategory',
            },
            qtySold: { $sum: '$items.quantity' },
            menuItemCore: { $first: { $ifNull: [{ $arrayElemAt: ['$menuItemData.core', 0] }, null] } },
            revenue: {
              $sum: {
                $multiply: [
                  { $ifNull: ['$items.price', 0] },
                  { $ifNull: ['$items.quantity', 0] },
                ],
              },
            },
            ordersSet: { $addToSet: '$_id' },
            dineInQty: {
              $sum: {
                $cond: [{ $eq: [{ $ifNull: ['$orderType', 'DineIn'] }, 'DineIn'] }, '$items.quantity', 0],
              },
            },
            pickUpQty: {
              $sum: {
                $cond: [{ $eq: [{ $ifNull: ['$orderType', 'DineIn'] }, 'PickUp'] }, '$items.quantity', 0],
              },
            },
            deliveryQty: {
              $sum: {
                $cond: [{ $eq: [{ $ifNull: ['$orderType', 'DineIn'] }, 'Delivery'] }, '$items.quantity', 0],
              },
            },
          },
        },
        { $sort: { qtySold: -1, revenue: -1 } }
      );

      const itemsResult = await Order.aggregate(aggPipeline);

      let totalQty = 0;
      let totalRevenue = 0;
      itemsResult.forEach((item) => {
        totalQty += item.qtySold || 0;
        totalRevenue += item.revenue || 0;
      });

      const formattedItems = itemsResult.map((item, index) => {
        const qty = item.qtySold || 0;
        const rev = item.revenue || 0;
        const pctQty = totalQty > 0 ? ((qty / totalQty) * 100).toFixed(1) : '0.0';
        const pctRev = totalRevenue > 0 ? ((rev / totalRevenue) * 100).toFixed(1) : '0.0';
        const avgPrice = qty > 0 ? Math.round(rev / qty) : 0;
        const orderCount = item.ordersSet ? item.ordersSet.length : 0;

        return {
          id: `${item._id.name}_${item._id.variantName}_${index}`,
          name: item._id.name,
          variantName: item._id.variantName,
          category: item._id.category,
          qtySold: qty,
          menuItemCore: (item.menuItemCore != null && item.menuItemCore > 0) ? item.menuItemCore : null,
          coreQty: (item.menuItemCore != null && item.menuItemCore > 0) ? item.menuItemCore * qty : null,
          revenue: rev,
          avgPrice,
          orderCount,
          percentageQty: parseFloat(pctQty),
          percentageRevenue: parseFloat(pctRev),
          dineInQty: item.dineInQty || 0,
          pickUpQty: item.pickUpQty || 0,
          deliveryQty: item.deliveryQty || 0,
        };
      });

      res.json({
        success: true,
        data: {
          periodLabel: label,
          start: start.toISOString(),
          end: end.toISOString(),
          summaryStats: {
            totalDishesSold: totalQty,
            totalRevenue,
            uniqueDishesCount: formattedItems.length,
            averageDishPrice: totalQty > 0 ? Math.round(totalRevenue / totalQty) : 0,
          },
          items: formattedItems,
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
