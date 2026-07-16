import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import app from '../app';
import { connectTestDB, disconnectTestDB, clearCollections } from './setup/testDb';
import Branch from '../models/Branch';
import Category from '../models/Category';
import CounterConfiguration from '../models/CounterConfiguration';
import MenuItem from '../models/MenuItem';
import PrintJob from '../models/PrintJob';
import Printer from '../models/Printer';
import Staff from '../models/Staff';
import Table from '../models/Table';
import { orderService } from '../services/order.service';

function makeToken(id: string): string {
  return jwt.sign(
    { id, role: 'Super Admin' },
    process.env['JWT_SECRET'] || 'test_secret_for_jest',
    { expiresIn: '1h' }
  );
}

describe('Print queue architecture', () => {
  let token = '';
  let branchId: string;
  let staffId: string;
  let tableId: string;
  let kitchenPrinterId: string;
  let receiptPrinterId: string;
  let menuItemId: string;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearCollections();

    const branch = await Branch.create({
      branchCode: 'PRT-TST',
      name: 'Printer Test Branch',
      address: '123 Queue Street',
      phone: '9999999999',
      gst: 'GST-PRINT-001',
      status: 'Active',
    });
    branchId = branch._id.toString();

    const staff = await Staff.create({
      employeeCode: 'EMP-PRINT-1',
      name: 'Print Admin',
      email: 'print-admin@test.com',
      phone: '9999999998',
      role: 'Super Admin',
      branchId: branch._id,
      active: true,
      username: 'printadmin',
      password: 'hashed',
      branchAccess: 'All Branches',
    });
    staffId = staff._id.toString();
    token = makeToken(staffId);

    const category = await Category.create({ name: 'Main Course' });

    const table = await Table.create({
      branchId: branch._id,
      sectionId: new mongoose.Types.ObjectId(),
      tableNumber: 'T1',
      capacity: 4,
      status: 'Available',
    });
    tableId = table._id.toString();

    const kitchenPrinter = await Printer.create({
      name: 'Kitchen Printer',
      ip: '192.168.1.10',
      port: 9100,
      type: 'thermal',
      duty: 'KOT',
      sections: ['Kitchen'],
      branchId: branch._id,
      isActive: true,
      status: 'ready',
      connection: 'LAN',
    });
    kitchenPrinterId = kitchenPrinter._id.toString();

    const receiptPrinter = await Printer.create({
      name: 'Receipt Printer',
      ip: '192.168.1.11',
      port: 9100,
      type: 'thermal',
      duty: 'RECEIPT',
      branchId: branch._id,
      isActive: true,
      status: 'ready',
      connection: 'LAN',
    });
    receiptPrinterId = receiptPrinter._id.toString();

    await CounterConfiguration.create({
      branchId: branch._id,
      counterName: 'Reception Counter',
      receiptPrinterId: receiptPrinter._id,
      isActive: true,
    });

    const menuItem = await MenuItem.create({
      categoryId: category._id,
      name: 'Chicken Mandi',
      description: 'Test printer routing',
      available: true,
      active: true,
      variants: [{ name: 'Regular', price: 350 }],
      addons: [],
      taxRate: 5,
      printerId: kitchenPrinter._id,
      sections: ['Kitchen'],
    });
    menuItemId = menuItem._id.toString();
  });

  it('queues a KOT print job and lets an agent claim and complete it', async () => {
    const order = await orderService.create({
      branchId,
      tableId,
      tableNumber: 'T1',
      staffId,
      items: [
        {
          menuItemId,
          name: 'Chicken Mandi',
          variantName: 'Regular',
          price: 350,
          quantity: 2,
          addons: [],
          notes: 'Less spicy',
          taxRate: 5,
          kotSequence: 1,
        },
      ],
    });

    const kotRes = await request(app)
      .post(`/api/v1/orders/${order._id.toString()}/kot`)
      .set('Authorization', `Bearer ${token}`)
      .send({ withPrint: true });

    expect(kotRes.status).toBe(200);
    expect(kotRes.body.success).toBe(true);
    expect(kotRes.body.message).toContain('queued');

    const jobsRes = await request(app)
      .get('/api/v1/printers/jobs')
      .set('Authorization', `Bearer ${token}`);

    expect(jobsRes.status).toBe(200);
    expect(jobsRes.body.data).toHaveLength(1);
    expect(jobsRes.body.data[0].jobType).toBe('KOT');
    expect(jobsRes.body.data[0].status).toBe('Pending');
    expect(jobsRes.body.data[0].printerId.toString()).toBe(kitchenPrinterId);
    expect(jobsRes.body.data[0].payload.items[0].name).toBe('Chicken Mandi');

    const claimRes = await request(app)
      .post('/api/v1/printers/jobs/claim')
      .send({ agentId: 'agent-kitchen-1', branchId });

    expect(claimRes.status).toBe(200);
    expect(claimRes.body.success).toBe(true);
    expect(claimRes.body.data).not.toBeNull();
    expect(claimRes.body.data.jobType).toBe('KOT');
    expect(claimRes.body.data.status).toBe('Printing');
    expect(claimRes.body.data.printerId.name).toBe('Kitchen Printer');

    const completeRes = await request(app)
      .post(`/api/v1/printers/jobs/${claimRes.body.data._id}/complete`)
      .send({ agentId: 'agent-kitchen-1', message: 'Printed successfully' });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.status).toBe('Completed');
    expect(completeRes.body.data.attempts).toHaveLength(1);
    expect(completeRes.body.data.attempts[0].status).toBe('Completed');
  });

  it('queues a receipt print job after payment using the assigned counter printer', async () => {
    const order = await orderService.create({
      branchId,
      tableId,
      tableNumber: 'T1',
      staffId,
      items: [
        {
          menuItemId,
          name: 'Chicken Mandi',
          variantName: 'Regular',
          price: 350,
          quantity: 1,
          addons: [],
          taxRate: 5,
          kotSequence: 1,
        },
      ],
    });

    const bill = await orderService.generateBill(order._id.toString(), branchId);

    const paymentRes = await request(app)
      .post('/api/v1/orders/payment')
      .set('Authorization', `Bearer ${token}`)
      .send({
        billId: bill._id.toString(),
        paymentMethods: { cash: 368, card: 0, upi: 0 },
        counterName: 'Reception Counter',
      });

    expect(paymentRes.status).toBe(200);
    expect(paymentRes.body.success).toBe(true);
    expect(paymentRes.body.data.receiptJob).toBeTruthy();
    expect(paymentRes.body.data.receiptJob.jobType).toBe('RECEIPT');

    const savedReceiptJob = await PrintJob.findById(paymentRes.body.data.receiptJob._id).lean();
    expect(savedReceiptJob).toBeTruthy();
    expect(savedReceiptJob?.printerId.toString()).toBe(receiptPrinterId);
    expect(savedReceiptJob?.status).toBe('Pending');
    expect(savedReceiptJob?.payload.billNumber).toBe(bill.billNumber);
    expect(savedReceiptJob?.payload.counterName).toBe('Reception Counter');
  });

  it('queues KOT jobs from the direct printer dispatcher even when no orderId is supplied', async () => {
    const dispatchRes = await request(app)
      .post('/api/v1/printers/dispatch-kot')
      .set('Authorization', `Bearer ${token}`)
      .send({
        branchId,
        orderNumber: 'ORD/FALLBACK/0001',
        tableId,
        tableNumber: 'T1',
        kotNumber: 'KOT-1',
        sequence: 1,
        items: [
          {
            menuItemId,
            name: 'Chicken Mandi',
            variantName: 'Regular',
            quantity: 1,
            notes: 'No onion',
          },
        ],
      });

    expect(dispatchRes.status).toBe(200);
    expect(dispatchRes.body.success).toBe(true);
    expect(dispatchRes.body.outcome.dispatched).toBe(1);
    expect(dispatchRes.body.outcome.results[0].status).toBe('queued');

    const jobs = await PrintJob.find({ jobType: 'KOT' }).sort({ createdAt: -1 }).lean();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.orderId).toBeFalsy();
    expect(jobs[0]?.branchId?.toString()).toBe(branchId);
    expect(jobs[0]?.payload.orderNumber).toBe('ORD/FALLBACK/0001');
    expect(jobs[0]?.payload.tableNumber).toBe('T1');
  });
});
