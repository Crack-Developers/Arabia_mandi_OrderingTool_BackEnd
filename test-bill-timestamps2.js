const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const Bill = require('./dist/models/Bill').default || require('./dist/models/Bill');
const Payment = require('./dist/models/Payment').default || require('./dist/models/Payment');

async function checkBillTimestamps() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const payment = await Payment.findById('82a29a61-1641-423a-9852-5baf1b7e6e02').lean();
  console.log(`Payment createdAt: ${payment?.createdAt}`);
  
  if (payment?.billId) {
    const bill = await Bill.findById(payment.billId).lean();
    console.log(`Bill createdAt: ${bill?.createdAt}`);
    console.log(`Bill updatedAt: ${bill?.updatedAt}`);
  }
  
  process.exit(0);
}
checkBillTimestamps();
