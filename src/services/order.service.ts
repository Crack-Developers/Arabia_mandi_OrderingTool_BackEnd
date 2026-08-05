import mongoose from 'mongoose';
import Order from '../models/Order';
import Table from '../models/Table';
import Bill from '../models/Bill';
import Payment from '../models/Payment';
import { auditLogService } from './auditLog.service';

export const orderService = {
  async getAll(branchId?: string, status?: string) {
    const filter: any = {};
    if (branchId) filter.branchId = branchId;
    if (status) filter.status = status;
    return Order.find(filter).sort({ createdAt: -1 });
  },

  async getById(id: string) {
    const order = await Order.findById(id);
    if (!order) throw { statusCode: 404, message: 'Order not found.' };
    return order;
  },

  async create(data: any) {
    // Generate unique order number across all branches
    let count = await Order.countDocuments({});
    let orderNum = data.orderNumber || `ORD/${new Date().getFullYear()}/${String(count + 1).padStart(4, '0')}`;
    while (await Order.exists({ orderNumber: orderNum })) {
      count++;
      orderNum = `ORD/${new Date().getFullYear()}/${String(count + 1).padStart(4, '0')}`;
    }
    data.orderNumber = orderNum;

    // Calculate totals
    let subtotal = 0;
    let totalTax = 0;
    (data.items || []).forEach((item: any) => {
      const itemSubtotal = (Number(item.price) || 0) * (Number(item.quantity) || 1);
      subtotal += itemSubtotal;
      const tRate = (item.taxRate !== undefined && item.taxRate !== null && item.taxRate !== '') ? Number(item.taxRate) : 0;
      totalTax += itemSubtotal * (tRate / 100);
    });

    data.subtotal = subtotal;
    data.cgst = Number((totalTax / 2).toFixed(2));
    data.sgst = Number((totalTax / 2).toFixed(2));
    data.total = Math.round(subtotal + data.cgst + data.sgst);

    const order = new Order(data);
    const savedOrder = await order.save();

    // Update table status to Occupied
    if (data.tableId) {
      await Table.findByIdAndUpdate(data.tableId, {
        status: 'Occupied',
        currentOrderId: savedOrder._id,
        occupiedSince: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    }

    // Record structured audit log
    await auditLogService.logAction({
      branchId: data.branchId || 'BR-MAIN',
      actionType: 'ORDER_CREATED',
      target: {
        entityType: 'ORDER',
        entityId: savedOrder._id.toString(),
        label: savedOrder.orderNumber,
      },
      details: {
        tableId: data.tableId,
        itemCount: (data.items || []).length,
        totalAmount: data.total,
      },
    });

    return savedOrder;
  },

  async addItems(id: string, items: any[]) {
    const order = await Order.findById(id);
    if (!order) throw { statusCode: 404, message: 'Order not found.' };
    if (order.status !== 'Active') throw { statusCode: 400, message: 'Cannot modify a non-active order.' };

    order.items.push(...items);

    // Recalculate totals
    let subtotal = 0;
    let totalTax = 0;
    order.items.forEach((item: any) => {
      const itemSubtotal = (Number(item.price) || 0) * (Number(item.quantity) || 1);
      subtotal += itemSubtotal;
      const tRate = (item.taxRate !== undefined && item.taxRate !== null && item.taxRate !== '') ? Number(item.taxRate) : 0;
      totalTax += itemSubtotal * (tRate / 100);
    });
    order.subtotal = subtotal;
    order.cgst = Number((totalTax / 2).toFixed(2));
    order.sgst = Number((totalTax / 2).toFixed(2));
    order.total = Math.round(subtotal + order.cgst + order.sgst);

    return order.save();
  },

  async updateStatus(id: string, status: 'Active' | 'Completed' | 'Cancelled') {
    const order = await Order.findByIdAndUpdate(id, { status }, { new: true });
    if (!order) throw { statusCode: 404, message: 'Order not found.' };

    await auditLogService.logAction({
      branchId: order.branchId?.toString() || 'BR-MAIN',
      actionType: status === 'Cancelled' ? 'ORDER_CANCELLED' : 'ORDER_UPDATED',
      target: {
        entityType: 'ORDER',
        entityId: order._id.toString(),
        label: order.orderNumber,
      },
      details: { newStatus: status },
    });

    return order;
  },

  async generateKOT(id: string, printedBy: string, withPrint: boolean = true) {
    const order = await Order.findById(id);
    if (!order) throw { statusCode: 404, message: 'Order not found.' };

    // ── Determine which items were already dispatched to the kitchen ──────────
    // IMPORTANT: Mongoose creates NEW _id values for sub-document copies stored
    // inside kots[].items. So we CANNOT match by _id across order.items and
    // kots[].items. We use menuItemId (the reference to the original menu item)
    // and the kotPrinted flag set after each successful KOT generation.
    const alreadyPrintedMenuIds = new Set<string>();
    for (const kot of order.kots as any[]) {
      for (const kotItem of kot.items || []) {
        if (kotItem.menuItemId) {
          alreadyPrintedMenuIds.add(String(kotItem.menuItemId));
        }
      }
    }

    const newItems = (order.items as any[]).filter((item) => {
      // Primary check: kotPrinted flag (set explicitly after each KOT)
      if (item.kotPrinted) return false;
      // Legacy check: menuItemId appeared in a previous KOT
      const menuId = item.menuItemId ? String(item.menuItemId) : null;
      if (menuId && alreadyPrintedMenuIds.has(menuId)) return false;
      return true;
    });

    if (newItems.length === 0) {
      throw { statusCode: 400, message: 'All items in this order have already been sent to the kitchen. Add new dishes first.' };
    }

    const nextSeq = order.kots.length + 1;
    const kotNumber = `KOT-${order.orderNumber.split('/').pop()}-${nextSeq}`;

    const newKot = {
      kotNumber,
      sequence:  nextSeq,
      items:     newItems,  // ← ONLY new unprinted items
      printedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      printedBy,
      reprintCount: 0,
      status:    'Active',
      withPrint,
    };

    order.kots.push(newKot as any);

    // ── Mark the newly-printed items so they grey out in the UI ──────────────
    const newMenuIds = new Set(newItems.map((i: any) => String(i.menuItemId)).filter(Boolean));
    for (const item of order.items as any[]) {
      if (!item.kotPrinted) {
        const menuId = item.menuItemId ? String(item.menuItemId) : null;
        if (menuId && newMenuIds.has(menuId)) {
          item.kotPrinted = true;
        }
      }
    }
    // Tell Mongoose the items array has been mutated so it persists the flag
    order.markModified('items');

    await order.save();

    // Audit log
    await auditLogService.logAction({
      branchId: order.branchId?.toString() || 'BR-MAIN',
      actionType: 'KOT_GENERATED',
      performedBy: { staffName: printedBy },
      target: {
        entityType: 'KOT',
        entityId: kotNumber,
        label: `KOT #${nextSeq} for ${order.orderNumber} (${withPrint ? 'Printed' : 'Saved Only'})`,
      },
      details: { itemCount: newItems.length, tableId: order.tableId, withPrint },
    });

    return { kot: newKot, order, withPrint };
  },


  async generateBill(id: string, branchId: string) {
    const order = await Order.findById(id);
    if (!order) throw { statusCode: 404, message: 'Order not found.' };

    const existingBill = await Bill.findOne({ orderId: order._id });
    if (existingBill) {
      existingBill.subtotal = order.subtotal;
      existingBill.cgst = order.cgst;
      existingBill.sgst = order.sgst;
      existingBill.grandTotal = order.total;
      await existingBill.save();
      return existingBill;
    }

    const isValidObjectId = (val: any) => /^[0-9a-fA-F]{24}$/.test(String(val || ''));
    const resolvedBranchId = isValidObjectId(branchId) ? new mongoose.Types.ObjectId(branchId) : order.branchId;

    let totalBills = await Bill.countDocuments({});
    let seq = totalBills + 1;
    let billNumber = `INV-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
    while (await Bill.exists({ billNumber })) {
      seq++;
      billNumber = `INV-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
    }

    const bill = new Bill({
      billNumber,
      branchId: resolvedBranchId,
      orderId: order._id,
      tableNumber: order.tableNumber,
      subtotal: order.subtotal,
      cgst: order.cgst,
      sgst: order.sgst,
      grandTotal: order.total,
      paymentStatus: 'Pending',
    });

    await bill.save();

    // Update table status to Billing
    await Table.findByIdAndUpdate(order.tableId, { status: 'Billing' });

    await auditLogService.logAction({
      branchId,
      actionType: 'BILL_GENERATED',
      target: {
        entityType: 'BILL',
        entityId: bill._id.toString(),
        label: bill.billNumber,
      },
      details: {
        orderId: order._id.toString(),
        grandTotal: order.total,
      },
    });

    return bill;
  },

  async processPayment(billId: string, paymentMethods: { cash: number; card: number; upi: number; other?: number }) {
    const bill = await Bill.findById(billId);
    if (!bill) throw { statusCode: 404, message: 'Bill not found.' };

    const totalPaid = (paymentMethods.cash || 0)
                    + (paymentMethods.card || 0)
                    + (paymentMethods.upi  || 0)
                    + (paymentMethods.other || 0);

    // Get the order FIRST so we can link branchId on the Payment document
    const order = await Order.findById(bill.orderId);

    const payment = new Payment({
      billId:      bill._id,
      orderId:     bill.orderId,                       // for tracing
      branchId:    bill.branchId,                      // for fast branch-level aggregations on Dashboard
      cash:        paymentMethods.cash  || 0,
      card:        paymentMethods.card  || 0,
      upi:         paymentMethods.upi   || 0,
      other:       paymentMethods.other || 0,
      totalPaid,
      paymentTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });

    await payment.save();

    // Mark bill as Paid
    bill.paymentStatus = 'Paid';
    await bill.save();

    // Complete the order and set completedAt for T.T.A calculation
    if (order) {
      order.status      = 'Completed';
      order.completedAt = new Date();           // ← used for avg table-turnaround on Dashboard
      order.synced      = false;                // mark for re-sync to Atlas with completedAt
      await order.save();

      await Table.findByIdAndUpdate(order.tableId, {
        status: 'Available',
        currentOrderId: undefined,
        occupiedSince:  undefined,
        mergedWith:     undefined,
      });
    }

    await auditLogService.logAction({
      branchId: bill.branchId?.toString() || 'BR-MAIN',
      actionType: 'PAYMENT_PROCESSED',
      target: {
        entityType: 'BILL',
        entityId: bill._id.toString(),
        label: bill.billNumber,
      },
      details: {
        totalPaid,
        paymentMethods,
      },
    });

    return { payment, bill };
  },

  async syncLocalOrder(data: any) {
    const isValidObjectId = (id: any) => /^[0-9a-fA-F]{24}$/.test(String(id || ''));
    const dummyId = new mongoose.Types.ObjectId('000000000000000000000001');

    const normalizeItems = (items: any[]) => {
      if (!Array.isArray(items)) return [];
      return items.map((item: any) => ({
        menuItemId: isValidObjectId(item.menuItemId || item.id)
          ? new mongoose.Types.ObjectId(item.menuItemId || item.id)
          : dummyId,
        name: item.name || 'Item',
        variantName: item.variantName || 'Regular',
        price: Number(item.price) || 0,
        quantity: Math.max(1, Number(item.quantity) || 1),
        taxRate: (typeof item.taxRate === 'number') ? item.taxRate : 0,
        addons: Array.isArray(item.addons) ? item.addons.map((a: any) => ({ name: a.name || '', price: Number(a.price) || 0 })) : [],
        notes: item.notes || '',
        kotSequence: Number(item.kotSequence) || 1,
      }));
    };

    const normalizeKots = (kots: any[]) => {
      if (!Array.isArray(kots)) return [];
      return kots.map((k: any, idx: number) => {
        const seq = Number(k.sequence) || Number(String(k.kotNumber || '').split('-').pop()) || idx + 1;
        return {
          kotNumber: k.kotNumber || `KOT-${seq}`,
          sequence: seq,
          items: normalizeItems(k.items || []),
          printedAt: k.printedAt || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          printedBy: k.printedBy || 'POS Staff',
          reprintCount: Number(k.reprintCount) || 0,
          status: ['Active', 'Cancelled', 'Modified', 'NotInBill'].includes(k.status) ? k.status : 'Active',
        };
      });
    };

    const branchId = isValidObjectId(data.branchId) ? new mongoose.Types.ObjectId(data.branchId) : dummyId;
    const tableId = isValidObjectId(data.tableId) ? new mongoose.Types.ObjectId(data.tableId) : dummyId;
    const staffId = isValidObjectId(data.staffId) ? new mongoose.Types.ObjectId(data.staffId) : dummyId;

    const items = normalizeItems(data.items || []);
    const kots = normalizeKots(data.kots || []);

    let existing: any = null;
    const checkId = data.dbOrderId || data._id;
    if (isValidObjectId(checkId)) {
      existing = await Order.findById(checkId);
    }
    if (!existing && data.orderNumber) {
      existing = await Order.findOne({ orderNumber: data.orderNumber });
    }

    if (existing) {
      existing.items = items as any;
      existing.kots = kots as any;
      existing.subtotal = Number(data.subtotal) || 0;
      existing.cgst = Number(data.cgst) || 0;
      existing.sgst = Number(data.sgst) || 0;
      existing.total = Number(data.total) || 0;
      if (data.status) existing.status = data.status;
      if (data.tableShiftCount !== undefined) existing.tableShiftCount = Number(data.tableShiftCount);
      const saved = await existing.save();
      await auditLogService.logAction({
        branchId: branchId.toString(),
        actionType: 'ORDER_UPDATED',
        target: {
          entityType: 'ORDER',
          entityId: saved._id.toString(),
          label: saved.orderNumber,
        },
        details: {
          itemCount: items.length,
          kotCount: kots.length,
          totalAmount: saved.total,
          status: saved.status,
        },
      });
      return saved;
    } else {
      let orderNum = data.orderNumber;
      if (!orderNum) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);
        
        let seq = await Order.countDocuments({
          branchId,
          createdAt: { $gte: startOfDay, $lte: endOfDay }
        });
        
        orderNum = `ORD-${seq + 1}`;
        while (await Order.exists({ orderNumber: orderNum, branchId, createdAt: { $gte: startOfDay, $lte: endOfDay } })) {
          seq++;
          orderNum = `ORD-${seq + 1}`;
        }
      }

      const order = new Order({
        orderNumber: orderNum,
        branchId,
        tableId,
        tableNumber: data.tableNumber || 'TBL',
        staffId,
        orderType: data.orderType || 'DineIn',
        status: data.status || 'Active',
        items: items as any,
        kots: kots as any,
        subtotal: Number(data.subtotal) || 0,
        cgst: Number(data.cgst) || 0,
        sgst: Number(data.sgst) || 0,
        total: Number(data.total) || 0,
        tableShiftCount: Number(data.tableShiftCount) || 0,
      });
      const saved = await order.save();
      await auditLogService.logAction({
        branchId: branchId.toString(),
        actionType: 'ORDER_CREATED',
        target: {
          entityType: 'ORDER',
          entityId: saved._id.toString(),
          label: saved.orderNumber,
        },
        details: {
          tableNumber: saved.tableNumber,
          itemCount: items.length,
          kotCount: kots.length,
          totalAmount: saved.total,
        },
      });
      return saved;
    }
  },
};
