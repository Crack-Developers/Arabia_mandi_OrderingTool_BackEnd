import Order from '../models/Order';
import Table from '../models/Table';
import Bill from '../models/Bill';
import Payment from '../models/Payment';

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
    // Generate order number
    const count = await Order.countDocuments({ branchId: data.branchId });
    data.orderNumber = data.orderNumber || `ORD/${new Date().getFullYear()}/${String(count + 1).padStart(4, '0')}`;

    // Calculate totals
    const subtotal = (data.items || []).reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
    data.subtotal = subtotal;
    data.cgst = Number((subtotal * 0.025).toFixed(2));
    data.sgst = Number((subtotal * 0.025).toFixed(2));
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

    return savedOrder;
  },

  async addItems(id: string, items: any[]) {
    const order = await Order.findById(id);
    if (!order) throw { statusCode: 404, message: 'Order not found.' };
    if (order.status !== 'Active') throw { statusCode: 400, message: 'Cannot modify a non-active order.' };

    order.items.push(...items);

    // Recalculate totals
    const subtotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    order.subtotal = subtotal;
    order.cgst = Number((subtotal * 0.025).toFixed(2));
    order.sgst = Number((subtotal * 0.025).toFixed(2));
    order.total = Math.round(subtotal + order.cgst + order.sgst);

    return order.save();
  },

  async updateStatus(id: string, status: 'Active' | 'Completed' | 'Cancelled') {
    const order = await Order.findByIdAndUpdate(id, { status }, { new: true });
    if (!order) throw { statusCode: 404, message: 'Order not found.' };
    return order;
  },

  async generateKOT(id: string, printedBy: string) {
    const order = await Order.findById(id);
    if (!order) throw { statusCode: 404, message: 'Order not found.' };

    const nextSeq = order.kots.length + 1;
    const kotNumber = `KOT-${order.orderNumber.split('/').pop()}-${nextSeq}`;

    const newKot = {
      kotNumber,
      sequence: nextSeq,
      items: order.items,
      printedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      printedBy,
      reprintCount: 0,
    };

    order.kots.push(newKot as any);
    await order.save();
    return { kot: newKot, order };
  },

  async generateBill(id: string, branchId: string) {
    const order = await Order.findById(id);
    if (!order) throw { statusCode: 404, message: 'Order not found.' };

    const billCount = await Bill.countDocuments({ branchId });
    const billNumber = `INV-${new Date().getFullYear()}-${String(billCount + 1).padStart(5, '0')}`;

    const bill = new Bill({
      billNumber,
      branchId,
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

    return bill;
  },

  async processPayment(billId: string, paymentMethods: { cash: number; card: number; upi: number }) {
    const bill = await Bill.findById(billId);
    if (!bill) throw { statusCode: 404, message: 'Bill not found.' };

    const totalPaid = paymentMethods.cash + paymentMethods.card + paymentMethods.upi;

    const payment = new Payment({
      billId: bill._id,
      cash: paymentMethods.cash,
      card: paymentMethods.card,
      upi: paymentMethods.upi,
      totalPaid,
      paymentTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });

    await payment.save();

    // Update bill status to Paid
    bill.paymentStatus = 'Paid';
    await bill.save();

    // Get the order and release the table
    const order = await Order.findById(bill.orderId);
    if (order) {
      order.status = 'Completed';
      await order.save();

      await Table.findByIdAndUpdate(order.tableId, {
        status: 'Available',
        currentOrderId: undefined,
        occupiedSince: undefined,
        mergedWith: undefined,
      });
    }

    return { payment, bill };
  },
};
