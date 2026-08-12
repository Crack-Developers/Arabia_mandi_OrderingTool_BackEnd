const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const Order = require('./dist/models/Order').default || require('./dist/models/Order');

async function findFriedChicken() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const orders = await Order.find({ "items.name": /Chicken/i }).lean();
  console.log(`Found ${orders.length} orders with Chicken.`);
  orders.forEach(o => {
    console.log(`Order ${o.orderNumber} - createdAt: ${o.createdAt} - status: ${o.status}`);
    o.items.forEach(i => {
      if (i.name.includes("Chicken")) console.log(`  - ${i.name} (Qty: ${i.quantity}, Price: ${i.price})`);
    });
  });
  
  process.exit(0);
}
findFriedChicken();
