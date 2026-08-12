const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const Order = require('./dist/models/Order').default || require('./dist/models/Order');

async function checkOrderTimestamps() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const order = await Order.findById('94847ef3-340d-4b82-83c6-d45996fc331b').lean();
  if (order) {
    console.log(`Order: ${order.orderNumber}`);
    console.log(`createdAt: ${order.createdAt}`);
    console.log(`updatedAt: ${order.updatedAt}`);
    console.log(`completedAt: ${order.completedAt}`);
    console.log(`items: ${order.items?.length}`);
  } else {
    console.log(`Order NOT FOUND!`);
  }
  
  process.exit(0);
}
checkOrderTimestamps();
