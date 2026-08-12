const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const Order = require('./dist/models/Order').default || require('./dist/models/Order');
const Payment = require('./dist/models/Payment').default || require('./dist/models/Payment');
const Bill = require('./dist/models/Bill').default || require('./dist/models/Bill');

async function checkFormats() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const orders = await Order.find({}).sort({_id: -1}).limit(5).lean();
  console.log("RECENT ORDERS:");
  orders.forEach(o => {
    console.log(`- ${o.orderNumber} | createdAt: ${o.createdAt} [${typeof o.createdAt}] | branchId: ${o.branchId}`);
  });

  const payments = await Payment.find({}).sort({_id: -1}).limit(5).lean();
  console.log("\nRECENT PAYMENTS:");
  payments.forEach(p => {
    console.log(`- ${p._id} | createdAt: ${p.createdAt} [${typeof p.createdAt}] | branchId: ${p.branchId}`);
  });

  const bills = await Bill.find({}).sort({_id: -1}).limit(5).lean();
  console.log("\nRECENT BILLS:");
  bills.forEach(b => {
    console.log(`- ${b.billNumber} | createdAt: ${b.createdAt} [${typeof b.createdAt}] | branchId: ${b.branchId}`);
  });
  
  process.exit(0);
}
checkFormats();
