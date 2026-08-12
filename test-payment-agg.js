const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const Payment = require('./dist/models/Payment').default || require('./dist/models/Payment');

async function testPaymentAgg() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const start = new Date('2026-08-03T00:00:00Z');
  const end = new Date('2026-08-09T23:59:59Z');
  
  const isoStart = start.toISOString();
  const isoEnd = end.toISOString();
  const dateFilter = {
    $or: [
      { createdAt: { $gte: start, $lte: end } },
      { createdAt: { $gte: isoStart, $lte: isoEnd } },
    ]
  };
  
  const paymentAgg = await Payment.aggregate([
    { $match: dateFilter },
    { $group: {
      _id: null,
      cash:      { $sum: { $ifNull: ['$cash', 0] } },
      card:      { $sum: { $ifNull: ['$card', 0] } },
      upi:       { $sum: { $ifNull: ['$upi', 0] } },
      other:     { $sum: { $ifNull: ['$other', 0] } },
      totalPaid: { $sum: { $ifNull: ['$totalPaid', { $ifNull: ['$total', 0] }] } },
      count:     { $sum: 1 },
    }},
  ]);
  
  console.log(JSON.stringify(paymentAgg, null, 2));
  
  const p = paymentAgg[0] || {};
  const paymentTotal = (p.cash || 0) + (p.card || 0) + (p.upi || 0) + (p.other || 0) || (p.totalPaid || 0);
  console.log(`Computed Payment Total: ${paymentTotal}`);
  
  process.exit(0);
}
testPaymentAgg();
