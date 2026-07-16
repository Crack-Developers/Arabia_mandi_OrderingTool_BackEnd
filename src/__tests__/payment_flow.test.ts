import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Order from '../models/Order';
import Bill from '../models/Bill';
import Payment from '../models/Payment';
import Table from '../models/Table';
import Branch from '../models/Branch';
import { orderService } from '../services/order.service';
import { dashboardController } from '../controllers/dashboard.controller';

let mongoServer: MongoMemoryServer;
let testBranchId: string;
let testTableId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  const branch = await Branch.create({
    name: 'Test Branch HQ',
    branchCode: 'TB-HQ',
    address: '123 Test Street',
    phone: '9999999999',
    gst: 'TESTGST123',
  });
  testBranchId = branch._id.toString();

  const table = await Table.create({
    branchId: branch._id,
    sectionId: new mongoose.Types.ObjectId(),
    tableNumber: 'Table 1',
    capacity: 4,
    status: 'Available',
  });
  testTableId = table._id.toString();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('POS Settlement & Real-time Dashboard Analytics Flow', () => {
  beforeEach(async () => {
    await Order.deleteMany({});
    await Bill.deleteMany({});
    await Payment.deleteMany({});
  });

  test('TC01: Local order sync -> Bill Generation -> Payment processing updates all Dashboard KPIs exactly', async () => {
    // 1. POS Syncs local order to backend
    const syncedOrder = await orderService.syncLocalOrder({
      orderNumber: 'ORD/2026/0101',
      branchId: testBranchId,
      tableId: testTableId,
      tableNumber: 'Table 1',
      status: 'Active',
      items: [
        { name: 'Mutton Mandi', price: 600, quantity: 2, kotSequence: 1 },
        { name: 'Kunafa', price: 300, quantity: 1, kotSequence: 1 },
      ],
      subtotal: 1500,
      cgst: 37.5,
      sgst: 37.5,
      total: 1575,
    });
    expect(syncedOrder._id).toBeDefined();
    expect(syncedOrder.status).toBe('Active');

    // 2. POS triggers Bill generation before settlement
    const generatedBill = await orderService.generateBill(syncedOrder._id.toString(), testBranchId);
    expect(generatedBill.billNumber).toBeDefined();
    expect(generatedBill.grandTotal).toBe(1575);
    expect(generatedBill.paymentStatus).toBe('Pending');

    // Check Dashboard BEFORE payment (should reflect totalOrders=1, notPaid=1575, totalSales=0)
    let dashboardData: any = null;
    const mockResBefore: any = {
      json: (payload: any) => { dashboardData = payload.data; },
      status: () => mockResBefore,
    };
    await dashboardController.getDashboardStats({ query: { branchId: testBranchId } } as any, mockResBefore, (e) => { throw e; });
    expect(dashboardData.salesStats.totalSales).toBe(0);
    expect(dashboardData.salesStats.notPaid).toBe(1575);
    expect(dashboardData.salesStats.totalOrders).toBe(1);
    expect(dashboardData.salesStats.successful).toBe(0);

    // 3. POS processes payment (Settle & Save: Cash ₹ 1000, UPI ₹ 575)
    const payResult = await orderService.processPayment(generatedBill._id.toString(), {
      cash: 1000,
      card: 0,
      upi: 575,
    });
    expect(payResult.bill.paymentStatus).toBe('Paid');
    expect(payResult.payment.totalPaid).toBe(1575);
    expect(payResult.payment.cash).toBe(1000);
    expect(payResult.payment.upi).toBe(575);

    const updatedOrder = await Order.findById(syncedOrder._id);
    expect(updatedOrder?.status).toBe('Completed');

    // 4. Check Dashboard AFTER payment (totalSales=1575, cash=1000, upi=575, successful=1)
    let dashboardAfter: any = null;
    const mockResAfter: any = {
      json: (payload: any) => { dashboardAfter = payload.data; },
      status: () => mockResAfter,
    };
    await dashboardController.getDashboardStats({ query: { branchId: testBranchId } } as any, mockResAfter, (e) => { throw e; });

    expect(dashboardAfter.salesStats.totalSales).toBe(1575);
    expect(dashboardAfter.salesStats.notPaid).toBe(0);
    expect(dashboardAfter.salesStats.cash).toBe(1000);
    expect(dashboardAfter.salesStats.online).toBe(575); // upi mapped to online
    expect(dashboardAfter.salesStats.totalOrders).toBe(1);
    expect(dashboardAfter.salesStats.successful).toBe(1);
  });

  test('TC02: Settling multiple orders with different payment methods correctly sums across Cash and Card', async () => {
    // Order A: Cash ₹ 500
    const orderA = await orderService.syncLocalOrder({
      orderNumber: 'ORD/2026/0102',
      branchId: testBranchId,
      items: [{ name: 'Chicken Mandi', price: 500, quantity: 1 }],
      total: 500,
    });
    const billA = await orderService.generateBill(orderA._id.toString(), testBranchId);
    await orderService.processPayment(billA._id.toString(), { cash: 500, card: 0, upi: 0 });

    // Order B: Card ₹ 1200
    const orderB = await orderService.syncLocalOrder({
      orderNumber: 'ORD/2026/0103',
      branchId: testBranchId,
      items: [{ name: 'Family Pack Mandi', price: 1200, quantity: 1 }],
      total: 1200,
    });
    const billB = await orderService.generateBill(orderB._id.toString(), testBranchId);
    await orderService.processPayment(billB._id.toString(), { cash: 0, card: 1200, upi: 0 });

    let dashboardSummary: any = null;
    const mockRes: any = {
      json: (payload: any) => { dashboardSummary = payload.data; },
      status: () => mockRes,
    };
    await dashboardController.getDashboardStats({ query: { branchId: testBranchId } } as any, mockRes, (e) => { throw e; });

    expect(dashboardSummary.salesStats.totalSales).toBe(1700);
    expect(dashboardSummary.salesStats.cash).toBe(500);
    expect(dashboardSummary.salesStats.card).toBe(1200);
    expect(dashboardSummary.salesStats.successful).toBe(2);
  });
});
