const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const Payment = require('./dist/models/Payment').default || require('./dist/models/Payment');
const Order = require('./dist/models/Order').default || require('./dist/models/Order');

async function findPayment() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const payments = await Payment.find({ createdAt: { $gte: new Date('2026-08-08T00:00:00Z') } }).lean();
  console.log(`Found ${payments.length} payments today.`);
  
  for (const p of payments) {
    console.log(`Payment: ID: ${p._id}, Bill: ${p.billId}, Order: ${p.orderId}, Cash: ${p.cash}, Total: ${p.totalPaid}`);
    if (p.orderId) {
      const order = await Order.findById(p.orderId).lean();
      if (order) {
        console.log(`  -> Order: ${order.orderNumber}, createdAt: ${order.createdAt}, items: ${order.items?.length}`);
      } else {
        console.log(`  -> Order NOT FOUND!`);
      }
    }
  }
  
  process.exit(0);
}
findPayment();
