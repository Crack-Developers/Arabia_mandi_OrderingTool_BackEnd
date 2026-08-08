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
    const lastDay = new Date(y, m + 1, 0).getDate();
    const mm = String(m + 1).padStart(2, '0');
    const start = new Date(`${y}-${mm}-01T00:00:00.000+05:30`);
    const end = new Date(`${y}-${mm}-${String(lastDay).padStart(2, '0')}T23:59:59.999+05:30`);
    const label = start.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' });
    return { start, end, label };
  } else if (filterType === 'year') {
    const y = parseInt(year || String(now.getFullYear()), 10) || now.getFullYear();
    const start = new Date(`${y}-01-01T00:00:00.000+05:30`);
    const end = new Date(`${y}-12-31T23:59:59.999+05:30`);
    const label = `Year ${y}`;
    return { start, end, label };
  } else if (filterType === 'week') {
    let base = now;
    if (date) {
      const [y, m, d] = date.split('-').map(Number);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        base = new Date(y, m - 1, d);
      }
    }
    const dayOfWeek = base.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const mon = new Date(base);
    mon.setDate(base.getDate() + diffToMonday);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);

    const monY = mon.getFullYear();
    const monM = String(mon.getMonth() + 1).padStart(2, '0');
    const monD = String(mon.getDate()).padStart(2, '0');
    const sunY = sun.getFullYear();
    const sunM = String(sun.getMonth() + 1).padStart(2, '0');
    const sunD = String(sun.getDate()).padStart(2, '0');

    const start = new Date(`${monY}-${monM}-${monD}T00:00:00.000+05:30`);
    const end = new Date(`${sunY}-${sunM}-${sunD}T23:59:59.999+05:30`);
    const label = `${start.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })} - ${end.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}`;
    return { start, end, label };
  } else {
    let dStr = date;
    if (!dStr) {
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      dStr = `${y}-${m}-${d}`;
    }
    const start = new Date(`${dStr}T00:00:00.000+05:30`);
    const end = new Date(`${dStr}T23:59:59.999+05:30`);
    const label = start.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
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
    try {
      const branch = await Branch.findById(oid);
      if (branch) {
        return { $or: [{ branchId: oid }, { branchId: String(branchId) }, { branchId: branch.branchCode }, { branchId: branch.name }].filter(Boolean) };
      }
    } catch {}
    return { $or: [{ branchId: oid }, { branchId: String(branchId) }] };
  }
  try {
    const branch = await Branch.findOne({ $or: [{ branchCode: branchId }, { name: branchId }] });
    if (branch) {
      return { $or: [{ branchId: branch._id }, { branchId: String(branch._id) }, { branchId }, { branchId: branch.branchCode }, { branchId: branch.name }].filter(Boolean) };
    }
  } catch {
    // fallback
  }
  return { branchId };
}

function getDateMatchQuery(start: Date, end: Date) {
  const isoStart = start.toISOString();
  const isoEnd = end.toISOString();
  return {
    $or: [
      { createdAt: { $gte: start, $lte: end } },
      { createdAt: { $gte: isoStart, $lte: isoEnd } },
    ]
  };
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
      const dateFilter = getDateMatchQuery(start, end);
      // Use $and to safely combine date and branch filters
      const orderMatch = Object.keys(branchFilter).length ? { $and: [dateFilter, branchFilter] } : dateFilter;
      const billMatch = Object.keys(branchFilter).length ? { $and: [dateFilter, branchFilter] } : dateFilter;

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
      const dateFilter      = getDateMatchQuery(start, end);
      
      // Use $and to safely combine date and branch filters without overwriting $or keys
      const orderMatch      = Object.keys(branchFilter).length ? { $and: [dateFilter, branchFilter] } : dateFilter;
      const billMatch       = Object.keys(branchFilter).length ? { $and: [dateFilter, branchFilter] } : dateFilter;
      const paymentMatch    = Object.keys(branchFilter).length ? { $and: [dateFilter, branchFilter] } : dateFilter;

      // ── Run ALL aggregations in parallel for speed ──────────────────────────
      const [
        billAgg,
        paymentAgg,
        orderAgg,
        hourlyAgg,
        orderTypeAgg,
        orderTypeRevAgg,
        itemAgg,
        kotAgg,
        kotsNotInBills,
      ] = await Promise.all([

        // 1. Bill-level stats: totalSales, notPaid, waiveOff, modified, reprinted
        Bill.aggregate([
          { $match: billMatch },
          { $group: {
            _id: null,
            totalSales: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $in: ['$paymentStatus', ['Paid', 'paid', 'PAID', 'Completed', 'completed', 'Settled', 'settled']] },
                      { $in: ['$status', ['Paid', 'paid', 'PAID', 'Completed', 'completed', 'Settled', 'settled']] },
                      { $gt: ['$grandTotal', 0] }
                    ]
                  },
                  { $ifNull: ['$grandTotal', { $ifNull: ['$total', 0] }] },
                  0
                ]
              }
            },
            notPaid: {
              $sum: {
                $cond: [
                  { $in: ['$paymentStatus', ['Pending', 'pending', 'unpaid', 'Unpaid']] },
                  { $ifNull: ['$grandTotal', { $ifNull: ['$total', 0] }] },
                  0
                ]
              }
            },
            waivedOff:     { $sum: { $ifNull: ['$waiveOff', { $ifNull: ['$discount', 0] }] } },
            billsModified: { $sum: { $cond: ['$billModified', 1, 0] } },
            billsReprinted:{ $sum: { $cond: [{ $gt: ['$reprintCount', 0] }, 1, 0] } },
          }},
        ]),

        // 2. Payment breakdown: cash, card, upi, other
        Payment.aggregate([
          { $match: paymentMatch },
          { $group: {
            _id: null,
            cash:      { $sum: { $ifNull: ['$cash', 0] } },
            card:      { $sum: { $ifNull: ['$card', 0] } },
            upi:       { $sum: { $ifNull: ['$upi', 0] } },
            other:     { $sum: { $ifNull: ['$other', 0] } },
            totalPaid: { $sum: { $ifNull: ['$totalPaid', { $ifNull: ['$total', 0] }] } },
            count:     { $sum: 1 },
          }},
        ]),

        // 3. Order counts: total, successful, cancelled
        Order.aggregate([
          { $match: orderMatch },
          { $group: {
            _id: null,
            total:     { $sum: 1 },
            completed: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['Completed', 'completed', 'Paid', 'paid', 'Settled', 'settled', 'Active', 'active']] },
                  1,
                  0
                ]
              }
            },
            cancelled: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['Cancelled', 'cancelled']] },
                  1,
                  0
                ]
              }
            },
          }},
        ]),

        // 4. Time-series paid-bill revenue (group by hour/date/month depending on filter)
        Bill.aggregate([
          { $match: { $and: [billMatch, { $or: [{ paymentStatus: { $in: ['Paid', 'paid', 'PAID', 'Completed', 'completed', 'Settled', 'settled'] } }, { grandTotal: { $gt: 0 } }] }] } },
          { $group: {
            _id: {
              hour: { $hour: { date: '$createdAt', timezone: '+05:30' } },
              date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:30' } },
              dayOfMonth: { $dayOfMonth: { date: '$createdAt', timezone: '+05:30' } },
              month: { $month: { date: '$createdAt', timezone: '+05:30' } },
            },
            revenue: { $sum: { $ifNull: ['$grandTotal', { $ifNull: ['$total', 0] }] } },
          }},
        ]),

        // 5. Order type split: DineIn / PickUp / Delivery (counts based on orders)
        Order.aggregate([
          { $match: orderMatch },
          { $group: {
            _id:     { $ifNull: ['$orderType', 'DineIn'] },
            count:   { $sum: 1 },
            avgTTA:  { $avg: {
              $cond: [
                { $and: [{ $ifNull: ['$completedAt', false] }, { $ifNull: ['$createdAt', false] }] },
                { $divide: [{ $subtract: [{ $toDate: '$completedAt' }, { $toDate: '$createdAt' }] }, 60000] }, // → minutes
                null,
              ],
            }},
          }},
        ]),

        // 5b. Order type split: revenue (based on paid bills)
        Bill.aggregate([
          { $match: { $and: [billMatch, { $or: [{ paymentStatus: { $in: ['Paid', 'paid', 'PAID', 'Completed', 'completed', 'Settled', 'settled'] } }, { grandTotal: { $gt: 0 } }] }] } },
          { $lookup: {
              from: 'orders',
              localField: 'orderId',
              foreignField: '_id',
              as: 'orderData'
          }},
          { $unwind: { path: '$orderData', preserveNullAndEmptyArrays: true } },
          { $group: {
            _id: { $ifNull: ['$orderData.orderType', 'DineIn'] },
            revenue: { $sum: { $ifNull: ['$grandTotal', { $ifNull: ['$total', 0] }] } }
          }}
        ]),

        // 6. Item performance: unwind order items, group by item name (include active & completed)
        Order.aggregate([
          { $match: { ...orderMatch, status: { $nin: ['Cancelled', 'cancelled'] } } },
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
      (orderTypeAgg as any[]).forEach(({ _id, count, avgTTA }) => {
        let key = _id || 'DineIn';
        if (key === 'Takeaway' || key === 'TakeAway') key = 'PickUp';
        if (orderTypeMap[key]) {
          orderTypeMap[key].count   += count;
          if (avgTTA) {
            orderTypeMap[key].avgTurnAroundMins = Math.round(avgTTA * 10) / 10;
          }
        }
      });
      (orderTypeRevAgg as any[]).forEach(({ _id, revenue }) => {
        let key = _id || 'DineIn';
        if (key === 'Takeaway' || key === 'TakeAway') key = 'PickUp';
        if (orderTypeMap[key]) {
          orderTypeMap[key].revenue += revenue;
        }
      });

      // ── Shape final response ────────────────────────────────────────────────
      const b  = (billAgg    as any[])[0] || {};
      const p  = (paymentAgg as any[])[0] || {};
      const o  = (orderAgg   as any[])[0] || {};
      const kl = (kotAgg     as any[])[0] || {};

      const paymentTotal = (p.cash || 0) + (p.card || 0) + (p.upi || 0) + (p.other || 0) || (p.totalPaid || 0);
      const computedTotalSales = Math.max(b.totalSales || 0, paymentTotal || 0);
      const computedTotalOrders = (o.total && o.total > 0) ? o.total : ((p.count && p.count > 0 && computedTotalSales > 0) ? p.count : (computedTotalSales > 0 ? 1 : 0));
      const computedSuccessful = (o.completed && o.completed > 0) ? o.completed : (o.total && o.total > 0 ? (o.total - (o.cancelled || 0)) : ((p.count && p.count > 0 && computedTotalSales > 0) ? p.count : (computedTotalSales > 0 ? 1 : 0)));

      // If order type revenue is less than total sales (e.g., due to payment fallback for incomplete bills), attribute the difference to DineIn
      const totalOrderTypeRev = orderTypeMap.DineIn.revenue + orderTypeMap.PickUp.revenue + orderTypeMap.Delivery.revenue;
      if (computedTotalSales > totalOrderTypeRev) {
        orderTypeMap.DineIn.revenue += (computedTotalSales - totalOrderTypeRev);
      }
      if (orderTypeMap.DineIn.count === 0 && orderTypeMap.PickUp.count === 0 && orderTypeMap.Delivery.count === 0 && computedSuccessful > 0) {
        orderTypeMap.DineIn.count = computedSuccessful;
      }

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
            totalSales:    computedTotalSales,
            notPaid:       b.notPaid     || 0,
            cash:          p.cash        || 0,
            card:          p.card        || 0,
            online:        p.upi         || 0,
            other:         p.other       || 0,
            totalOrders:   computedTotalOrders,
            successful:    computedSuccessful,
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
      const dateFilter = getDateMatchQuery(start, end);
      
      const isoStart = start.toISOString();
      const isoEnd = end.toISOString();

      // STRICT ALIGNMENT: To prevent double-counting across midnight,
      // orders are assigned to the date of their transaction (Bill/Payment).
      const transactionMatch = Object.keys(branchFilter).length ? { $and: [dateFilter, branchFilter] } : dateFilter;
      const [payments, bills] = await Promise.all([
        Payment.find(transactionMatch).select('orderId').lean(),
        Bill.find(transactionMatch).select('orderId').lean()
      ]);
      const transactionOrderIds = [
        ...payments.map(p => p.orderId),
        ...bills.map(b => b.orderId)
      ].filter(Boolean);

      const orderDateFilter = {
        $or: [
          // 1. Order had a transaction (Bill or Payment) on this date
          { _id: { $in: transactionOrderIds } },
          // 2. Order was explicitly marked completed on this date
          { completedAt: { $gte: start, $lte: end } },
          { completedAt: { $gte: isoStart, $lte: isoEnd } },
          // 3. Order was created on this date AND remains unpaid/unbilled
          { 
            createdAt: { $gte: start, $lte: end },
            status: { $nin: ['Paid', 'paid', 'PAID', 'Completed', 'completed', 'Settled', 'settled', 'Billed', 'billed'] }
          },
          { 
            createdAt: { $gte: isoStart, $lte: isoEnd },
            status: { $nin: ['Paid', 'paid', 'PAID', 'Completed', 'completed', 'Settled', 'settled', 'Billed', 'billed'] }
          }
        ]
      };

      const orderMatch: any = Object.keys(branchFilter).length 
        ? { $and: [orderDateFilter, branchFilter, { status: { $nin: ['Cancelled', 'cancelled'] } }] }
        : { ...orderDateFilter, status: { $nin: ['Cancelled', 'cancelled'] } };

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
          $match: { resolvedCategory: { $regex: new RegExp(`^${category}$`, 'i') } },
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
            // Revenue = price × qty + tax (so it matches Bill.grandTotal used in HQ Analytics)
            revenue: {
              $sum: {
                $let: {
                  vars: {
                    effectivePrice: {
                      $let: {
                        vars: {
                          matchedVariant: {
                            $arrayElemAt: [
                              {
                                $filter: {
                                  input: { $ifNull: [{ $arrayElemAt: ['$menuItemData.variants', 0] }, []] },
                                  as: 'v',
                                  cond: { $eq: ['$$v.name', '$items.variantName'] }
                                }
                              },
                              0
                            ]
                          }
                        },
                        in: {
                          $cond: [
                            { $gt: ['$items.price', 0] },
                            '$items.price',
                            { $ifNull: ['$$matchedVariant.price', 0] }
                          ]
                        }
                      }
                    },
                    qty: { $ifNull: ['$items.quantity', 0] },
                    taxRate: { $ifNull: ['$items.taxRate', 0] },
                  },
                  in: {
                    $let: {
                      vars: {
                        lineTotal: { $multiply: ['$$effectivePrice', '$$qty'] }
                      },
                      in: {
                        $add: [
                          '$$lineTotal',
                          { $multiply: ['$$lineTotal', { $divide: ['$$taxRate', 100] }] },
                        ]
                      }
                    }
                  }
                }
              }
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

      // Also fetch Bill-level totalSales for header consistency with HQ Analytics
      const [itemsResult, billTotalAgg, paymentAgg] = await Promise.all([
        Order.aggregate(aggPipeline),
        Bill.aggregate([
          { 
            $match: Object.keys(branchFilter).length 
              ? { $and: [dateFilter, branchFilter, { $or: [{ paymentStatus: { $in: ['Paid', 'paid', 'PAID', 'Completed', 'completed', 'Settled', 'settled'] } }, { grandTotal: { $gt: 0 } }] }] }
              : { ...dateFilter, $or: [{ paymentStatus: { $in: ['Paid', 'paid', 'PAID', 'Completed', 'completed', 'Settled', 'settled'] } }, { grandTotal: { $gt: 0 } }] }
          },
          { $group: { _id: null, totalSales: { $sum: { $ifNull: ['$grandTotal', { $ifNull: ['$total', 0] }] } } } },
        ]),
        Payment.aggregate([
          { 
            $match: Object.keys(branchFilter).length 
              ? { $and: [dateFilter, branchFilter] } 
              : dateFilter 
          },
          { $group: { 
              _id: null, 
              totalPaid: { $sum: { $ifNull: ['$totalPaid', { $ifNull: ['$total', { $add: [{ $ifNull: ['$cash', 0] }, { $ifNull: ['$card', 0] }, { $ifNull: ['$upi', 0] }, { $ifNull: ['$other', 0] }] }] }] } } 
            } 
          },
        ])
      ]);

      let totalQty = 0;
      let totalItemRevenue = 0;
      itemsResult.forEach((item) => {
        totalQty += item.qtySold || 0;
        totalItemRevenue += item.revenue || 0;
      });
      // DISH SUMMARY STRICT ALIGNMENT: 
      // The "Total Revenue" on the Dish Summary page must exactly match the sum of the items displayed.
      // If we use Payment or Bill totals here, the page will show mathematically impossible metrics 
      // (e.g. 2205 Total Revenue but only 934 worth of items) due to POS syncing anomalies or non-item fees.
      const totalRevenue = totalItemRevenue;

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
            totalRevenue: totalRevenue,
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
