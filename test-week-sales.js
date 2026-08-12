const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const Payment = require('./dist/models/Payment').default || require('./dist/models/Payment');
const Bill = require('./dist/models/Bill').default || require('./dist/models/Bill');

async function findWeekSales() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const start = new Date('2026-08-03T00:00:00Z');
  const end = new Date('2026-08-09T23:59:59Z');
  
  const payments = await Payment.find({ createdAt: { $gte: start, $lte: end } }).lean();
  console.log(`Found ${payments.length} payments this week.`);
  let pSum = 0;
  for (const p of payments) {
    pSum += p.totalPaid;
    console.log(`Payment: ${p.createdAt} - ${p.totalPaid}`);
  }
  console.log(`Total Payments: ${pSum}`);

  const bills = await Bill.find({ createdAt: { $gte: start, $lte: end }, $or: [{ paymentStatus: { $in: ['Paid', 'paid', 'PAID', 'Completed', 'completed', 'Settled', 'settled'] } }, { grandTotal: { $gt: 0 } }] }).lean();
  console.log(`Found ${bills.length} bills this week.`);
  let bSum = 0;
  for (const b of bills) {
    bSum += (b.grandTotal || b.total || 0);
    console.log(`Bill: ${b.createdAt} - ${b.grandTotal || b.total}`);
  }
  console.log(`Total Bills: ${bSum}`);
  
  process.exit(0);
}
findWeekSales();
