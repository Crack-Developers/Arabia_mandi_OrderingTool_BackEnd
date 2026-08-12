const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const Order = require('./dist/models/Order').default || require('./dist/models/Order');

async function checkAllOrdersToday() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const start = new Date('2026-08-08T00:00:00.000+05:30');
  const end = new Date('2026-08-08T23:59:59.999+05:30');
  const isoStart = start.toISOString();
  const isoEnd = end.toISOString();
  
  const dateFilter = {
    $or: [
      { createdAt: { $gte: start, $lte: end } },
      { createdAt: { $gte: isoStart, $lte: isoEnd } },
    ]
  };

  const orders = await Order.find(dateFilter).lean();
  orders.forEach(o => {
    if (o.items && o.items.length) {
      o.items.forEach(i => console.log(`  - ${i.name} (Qty: ${i.quantity} [${typeof i.quantity}], Price: ${i.price} [${typeof i.price}])`));
    }
  });
  
  process.exit(0);
}
checkAllOrdersToday();
