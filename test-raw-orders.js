const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const Order = require('./dist/models/Order').default || require('./dist/models/Order');

async function checkRawOrders() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  // Find orders from today
  const start = new Date();
  start.setHours(0,0,0,0);
  const end = new Date();
  end.setHours(23,59,59,999);
  
  const orders = await Order.find({ createdAt: { $gte: start, $lte: end } }).lean();
  console.log(`Found ${orders.length} orders today.`);
  orders.forEach(o => {
    console.log(`Order ${o.orderNumber} - items type: ${Array.isArray(o.items) ? 'Array' : typeof o.items}, items length: ${o.items?.length}`);
    if (o.items && o.items.length > 0) {
      console.log(`  First item type: ${typeof o.items[0]}`);
      if (typeof o.items[0] === 'string') {
         console.log(`  String content: ${o.items[0].substring(0, 100)}`);
      }
    } else if (o._doc && o._doc.items) {
      // In case it's not even an array in raw BSON
      console.log(`  Raw items type: ${typeof o._doc.items}`);
    }
  });
  
  process.exit(0);
}
checkRawOrders();
