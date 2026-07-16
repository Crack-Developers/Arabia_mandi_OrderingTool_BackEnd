/**
 * dashboard.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration tests for GET /api/v1/dashboard/stats
 *
 * Strategy:
 *  - Spin up MongoMemoryServer (via globalSetup)
 *  - Connect mongoose to in-memory DB before all tests
 *  - Seed realistic Orders, Bills, Payments into the DB
 *  - Hit the dashboard endpoint and assert the aggregated numbers are correct
 *  - Clear DB after each test suite
 * ─────────────────────────────────────────────────────────────────────────────
 */

import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../app';
import { connectTestDB, disconnectTestDB, clearCollections } from './setup/testDb';
import Order from '../models/Order';
import Bill  from '../models/Bill';
import Payment from '../models/Payment';
import Branch from '../models/Branch';
import Staff  from '../models/Staff';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeToken(id: string): string {
  return jwt.sign(
    { id, role: 'Super Admin' },
    process.env['JWT_SECRET'] || 'test_secret_for_jest',
    { expiresIn: '1h' }
  );
}

let TOKEN = '';

function todayAtHour(hour: number): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
}
// ─── Test Data Seeds ──────────────────────────────────────────────────────────

let branchId: mongoose.Types.ObjectId;
let tableId:  mongoose.Types.ObjectId;
let staffId:  mongoose.Types.ObjectId;

async function seedBaseData() {
  const branch = await Branch.create({
    name: 'Test Branch', address: 'Test St', city: 'Chennai',
    phone: '9999999999', email: 'test@branch.com', status: 'Active',
    branchCode: 'TST', gst: 'GST1234',
  });
  branchId = branch._id as mongoose.Types.ObjectId;

  const staff = await Staff.create({
    name: 'Test Staff', username: 'teststaff', password: 'hashed',
    role: 'Super Admin', branchId, active: true,
    phone: '9999999999', email: 'staff@test.com', employeeCode: 'EMP001'
  });
  staffId = staff._id as mongoose.Types.ObjectId;
  TOKEN = makeToken(staffId.toString());

  tableId = new mongoose.Types.ObjectId();
}

async function seedOrderWithBillAndPayment(opts: {
  orderType?: 'DineIn' | 'PickUp' | 'Delivery';
  total?: number;
  cash?: number;
  card?: number;
  upi?: number;
  other?: number;
  status?: 'Active' | 'Completed' | 'Cancelled';
  billStatus?: 'Paid' | 'Pending';
  hoursAgo?: number;
  kotStatus?: 'Active' | 'Cancelled' | 'Modified';
  completedAfterMins?: number;
}) {
  const {
    orderType = 'DineIn', total = 500,
    cash = 0, card = 0, upi = 0, other = 0,
    status = 'Completed', billStatus = 'Paid',
    hoursAgo = 2, kotStatus = 'Active',
    completedAfterMins = 20,
  } = opts;

  const createdAt = todayAtHour(new Date().getHours() - hoursAgo);
  const completedAt = new Date(createdAt.getTime() + completedAfterMins * 60_000);

  const order = await Order.create({
    orderNumber: `ORD-TEST-${Date.now()}-${Math.random()}`,
    branchId, tableId, staffId,
    tableNumber: 'T1',
    orderType,
    status,
    items: [{
      menuItemId: new mongoose.Types.ObjectId(),
      name: 'Mandi', variantName: 'Full', price: total, quantity: 1,
      addons: [], kotSequence: 1,
    }],
    kots: [{
      kotNumber: `KOT-TEST-${Date.now()}`,
      sequence: 1,
      items: [],
      printedAt: '',
      printedBy: 'staff',
      reprintCount: kotStatus === 'Active' ? 0 : 1,
      status: kotStatus,
    }],
    subtotal: total,
    cgst: total * 0.025,
    sgst: total * 0.025,
    total,
    completedAt: status === 'Completed' ? completedAt : undefined,
    createdAt,
    updatedAt: createdAt,
  });

  const bill = await Bill.create({
    billNumber: `INV-TEST-${Date.now()}-${Math.random()}`,
    branchId, orderId: order._id,
    tableNumber: 'T1',
    subtotal: total, cgst: total * 0.025, sgst: total * 0.025,
    grandTotal: total,
    waiveOff: 0,
    paymentStatus: billStatus,
    billModified: false,
    reprintCount: 0,
    createdAt, updatedAt: createdAt,
  });

  if (billStatus === 'Paid') {
    await Payment.create({
      billId: bill._id, orderId: order._id, branchId,
      cash, card, upi, other,
      totalPaid: cash + card + upi + other,
      paymentTime: '',
      createdAt, updatedAt: createdAt,
    });
  }

  return { order, bill };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Dashboard Stats API', () => {
  beforeAll(async () => {
    await connectTestDB();
    await seedBaseData();
  });

  afterEach(async () => {
    await Order.deleteMany({});
    await Bill.deleteMany({});
    await Payment.deleteMany({});
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  // ── 1. Health Check ─────────────────────────────────────────────────────────
  describe('GET /api/health', () => {
    it('should return 200 OK', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── 2. Auth Guard ───────────────────────────────────────────────────────────
  describe('GET /api/v1/dashboard/stats — Auth', () => {
    it('should return 401 without a token', async () => {
      const res = await request(app).get('/api/v1/dashboard/stats');
      expect(res.status).toBe(401);
    });

    it('should return 200 with a valid token', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── 3. Empty State ──────────────────────────────────────────────────────────
  describe('GET /api/v1/dashboard/stats — empty DB', () => {
    it('should return all zeros when no orders exist', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`);

      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.salesStats.totalSales).toBe(0);
      expect(d.salesStats.totalOrders).toBe(0);
      expect(d.salesStats.cash).toBe(0);
      expect(d.salesStats.card).toBe(0);
      expect(d.salesStats.online).toBe(0);
      expect(d.salesStats.notPaid).toBe(0);
      expect(d.orderTypes.dineIn.count).toBe(0);
      expect(d.orderTypes.pickUp.count).toBe(0);
      expect(d.orderTypes.delivery.count).toBe(0);
      expect(d.leakage.kotsCancelled).toBe(0);
      expect(d.leakage.kotsNotInBills).toBe(0);
      expect(d.itemPerformance.top).toHaveLength(0);
    });
  });

  // ── 4. Sales Stats Accuracy ─────────────────────────────────────────────────
  describe('GET /api/v1/dashboard/stats — sales calculations', () => {
    it('should correctly tally totalSales from paid bills', async () => {
      await seedOrderWithBillAndPayment({ total: 1000, cash: 1000, billStatus: 'Paid' });
      await seedOrderWithBillAndPayment({ total: 500,  cash: 500,  billStatus: 'Paid' });

      const res = await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`);

      expect(res.body.data.salesStats.totalSales).toBe(1500);
    });

    it('should correctly tally notPaid from pending bills', async () => {
      await seedOrderWithBillAndPayment({ total: 800, billStatus: 'Pending', status: 'Active' });

      const res = await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`);

      expect(res.body.data.salesStats.notPaid).toBe(800);
      expect(res.body.data.salesStats.totalSales).toBe(0);
    });

    it('should break down payment methods: cash, card, upi, other', async () => {
      await seedOrderWithBillAndPayment({ total: 1000, cash: 400, card: 300, upi: 200, other: 100 });

      const { salesStats } = (await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`)).body.data;

      expect(salesStats.cash).toBe(400);
      expect(salesStats.card).toBe(300);
      expect(salesStats.online).toBe(200);
      expect(salesStats.other).toBe(100);
    });

    it('should count totalOrders, successful and cancelled correctly', async () => {
      await seedOrderWithBillAndPayment({ total: 500, cash: 500, status: 'Completed' });
      await seedOrderWithBillAndPayment({ total: 300, cash: 300, status: 'Completed' });
      await seedOrderWithBillAndPayment({ total: 200, status: 'Cancelled', billStatus: 'Pending' });

      const { salesStats } = (await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`)).body.data;

      expect(salesStats.totalOrders).toBe(3);
      expect(salesStats.successful).toBe(2);
      expect(salesStats.cancelled).toBe(1);
    });
  });

  // ── 5. Order Type Split ─────────────────────────────────────────────────────
  describe('GET /api/v1/dashboard/stats — order type split', () => {
    it('should split revenue correctly across DineIn, PickUp, Delivery', async () => {
      await seedOrderWithBillAndPayment({ total: 1000, cash: 1000, orderType: 'DineIn' });
      await seedOrderWithBillAndPayment({ total: 400,  cash: 400,  orderType: 'PickUp' });
      await seedOrderWithBillAndPayment({ total: 200,  cash: 200,  orderType: 'Delivery' });

      const { orderTypes } = (await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`)).body.data;

      expect(orderTypes.dineIn.count).toBe(1);
      expect(orderTypes.dineIn.revenue).toBe(1000);
      expect(orderTypes.pickUp.count).toBe(1);
      expect(orderTypes.pickUp.revenue).toBe(400);
      expect(orderTypes.delivery.count).toBe(1);
      expect(orderTypes.delivery.revenue).toBe(200);
    });

    it('should calculate T.T.A (avg turnaround) for DineIn orders', async () => {
      // 2 orders completed: one in 10 mins, one in 20 mins → avg = 15 mins
      await seedOrderWithBillAndPayment({ total: 500, cash: 500, orderType: 'DineIn', completedAfterMins: 10 });
      await seedOrderWithBillAndPayment({ total: 500, cash: 500, orderType: 'DineIn', completedAfterMins: 20 });

      const { orderTypes } = (await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`)).body.data;

      expect(orderTypes.dineIn.avgTurnAroundMins).toBeCloseTo(15, 0);
    });
  });

  // ── 6. Leakage ──────────────────────────────────────────────────────────────
  describe('GET /api/v1/dashboard/stats — leakage', () => {
    it('should count cancelled KOTs', async () => {
      await seedOrderWithBillAndPayment({ total: 500, cash: 500, kotStatus: 'Cancelled' });

      const res = await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`);
      if (!res.body.success) console.log('API Error:', res.body);
      const { leakage } = res.body.data;

      expect(leakage.kotsCancelled).toBe(1);
    });

    it('should count modified KOTs', async () => {
      await seedOrderWithBillAndPayment({ total: 500, cash: 500, kotStatus: 'Modified' });

      const { leakage } = (await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`)).body.data;

      expect(leakage.kotsModified).toBe(1);
    });

    it('should count KOTs not used in bills (Active orders with KOTs)', async () => {
      // Active order with a KOT but no bill paid = "not used in bill"
      await seedOrderWithBillAndPayment({ total: 300, status: 'Active', billStatus: 'Pending', kotStatus: 'Active' });
      // Completed order should NOT be counted
      await seedOrderWithBillAndPayment({ total: 500, cash: 500, status: 'Completed', kotStatus: 'Active' });

      const { leakage } = (await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`)).body.data;

      expect(leakage.kotsNotInBills).toBe(1);
    });

    it('should count reprinted bills', async () => {
      const { bill } = await seedOrderWithBillAndPayment({ total: 500, cash: 500 });
      await Bill.findByIdAndUpdate(bill._id, { reprintCount: 2 });

      const { leakage } = (await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`)).body.data;

      expect(leakage.billsReprinted).toBe(1);
    });

    it('should count modified bills', async () => {
      const { bill } = await seedOrderWithBillAndPayment({ total: 500, cash: 500 });
      await Bill.findByIdAndUpdate(bill._id, { billModified: true });

      const { leakage } = (await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`)).body.data;

      expect(leakage.billsModified).toBe(1);
    });
  });

  // ── 7. Item Performance ─────────────────────────────────────────────────────
  describe('GET /api/v1/dashboard/stats — item performance', () => {
    it('should list top performing items by quantity', async () => {
      // Seed 2 orders with different items
      await Order.create({
        orderNumber: `ORD-IP-1-${Date.now()}`,
        branchId, tableId, staffId,
        tableNumber: 'T1', orderType: 'DineIn', status: 'Completed',
        items: [
          { menuItemId: new mongoose.Types.ObjectId(), name: 'Mandi Full', variantName: 'Full',   price: 500, quantity: 3, addons: [], kotSequence: 1 },
          { menuItemId: new mongoose.Types.ObjectId(), name: 'Water Bottle', variantName: 'Std', price: 20,  quantity: 5, addons: [], kotSequence: 1 },
        ],
        kots: [], subtotal: 1600, cgst: 40, sgst: 40, total: 1680,
        createdAt: new Date(), updatedAt: new Date(),
      });

      const { itemPerformance } = (await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`)).body.data;

      expect(itemPerformance.top.length).toBeGreaterThan(0);
      // Water Bottle (qty 5) should outrank Mandi Full (qty 3)
      expect(itemPerformance.top[0].name).toBe('Water Bottle');
      expect(itemPerformance.top[0].qtySold).toBe(5);
      expect(itemPerformance.top[1].name).toBe('Mandi Full');
      expect(itemPerformance.top[1].qtySold).toBe(3);
    });
  });

  // ── 8. Branch Filter ────────────────────────────────────────────────────────
  describe('GET /api/v1/dashboard/stats — branch filter', () => {
    it('should only return data for the requested branchId', async () => {
      const otherBranch = await Branch.create({
        name: 'Other Branch', address: '2nd St', city: 'Chennai',
        phone: '8888888888', email: 'other@branch.com', status: 'Active',
        branchCode: 'OTH', gst: 'GST9999',
      });

      // Seed one order on primary branch (₹1000) and one on other branch (₹500)
      await seedOrderWithBillAndPayment({ total: 1000, cash: 1000 }); // uses global branchId

      // Create order for other branch manually
      await Order.create({
        orderNumber: `ORD-OTHER-${Date.now()}`,
        branchId: otherBranch._id, tableId, staffId,
        tableNumber: 'T2', orderType: 'DineIn', status: 'Completed',
        items: [{ menuItemId: new mongoose.Types.ObjectId(), name: 'Kebab', variantName: 'Half', price: 500, quantity: 1, addons: [], kotSequence: 1 }],
        kots: [], subtotal: 500, cgst: 12.5, sgst: 12.5, total: 500,
        createdAt: new Date(), updatedAt: new Date(),
      });

      // Filter for primary branch only
      const res = await request(app)
        .get(`/api/v1/dashboard/stats?branchId=${branchId}`)
        .set('Authorization', `Bearer ${TOKEN}`);

      expect(res.body.data.salesStats.totalOrders).toBe(1);

      // ALL branches
      const resAll = await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`);

      expect(resAll.body.data.salesStats.totalOrders).toBe(2);
    });
  });

  // ── 9. Hourly Sales Buckets ─────────────────────────────────────────────────
  describe('GET /api/v1/dashboard/stats — hourly sales', () => {
    it('should return exactly 6 hourly time-slot buckets', async () => {
      const { salesStats } = (await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`)).body.data;

      expect(salesStats.hourlySales).toHaveLength(6);
      expect(salesStats.hourlySales[0].label).toBe('01:00am - 05:00am');
      expect(salesStats.hourlySales[5].label).toBe('09:00pm - 01:00am');
    });

    it('all hourly revenues should be 0 when no paid bills exist', async () => {
      const { salesStats } = (await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`)).body.data;

      salesStats.hourlySales.forEach((slot: any) => {
        expect(slot.revenue).toBe(0);
      });
    });
  });

  // ── 10. Date Filtering ──────────────────────────────────────────────────────
  describe('GET /api/v1/dashboard/stats — date filtering', () => {
    it('should return 0 orders when querying a past date with no data', async () => {
      await seedOrderWithBillAndPayment({ total: 500, cash: 500 }); // today

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0];

      const res = await request(app)
        .get(`/api/v1/dashboard/stats?date=${dateStr}`)
        .set('Authorization', `Bearer ${TOKEN}`);

      expect(res.body.data.salesStats.totalOrders).toBe(0);
      expect(res.body.data.salesStats.totalSales).toBe(0);
    });

    it('should return data for today by default (no date param)', async () => {
      await seedOrderWithBillAndPayment({ total: 1200, cash: 1200 });

      const res = await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`);

      expect(res.body.data.salesStats.totalSales).toBe(1200);
    });
  });

  // ── 11. Response Shape Validation ──────────────────────────────────────────
  describe('GET /api/v1/dashboard/stats — response shape', () => {
    it('should return the correct top-level data keys', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');

      const d = res.body.data;
      expect(d).toHaveProperty('salesStats');
      expect(d).toHaveProperty('orderTypes');
      expect(d).toHaveProperty('leakage');
      expect(d).toHaveProperty('itemPerformance');
      expect(d).toHaveProperty('expensesWithdrawals');
      expect(d).toHaveProperty('lastUpdated');
    });

    it('salesStats should have all required sub-keys', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`);

      const { salesStats } = res.body.data;
      ['totalSales','notPaid','cash','card','online','other',
       'totalOrders','successful','cancelled','complementary','hourlySales'
      ].forEach(key => expect(salesStats).toHaveProperty(key));
    });

    it('leakage should have all required sub-keys', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/stats')
        .set('Authorization', `Bearer ${TOKEN}`);

      const { leakage } = res.body.data;
      ['kotsCancelled','kotsModified','kotsNotInBills','kotsShifted',
       'billsModified','billsReprinted','waivedOff'
      ].forEach(key => expect(leakage).toHaveProperty(key));
    });
  });
});
