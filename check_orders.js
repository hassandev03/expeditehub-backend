require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const Order = require('./src/modules/orders/order.model');

async function test() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');
  const orders = await Order.find({}).sort({ createdAt: -1 }).limit(5);
  console.log('Recent 5 orders:', JSON.stringify(orders, null, 2));
  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
