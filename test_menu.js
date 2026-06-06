require('dotenv').config({ path: './.env' });
const { redisClient } = require('./config/redis');

async function test() {
  const keys = await redisClient.keys('menu:*');
  if (keys.length > 0) {
    await redisClient.del(keys);
    console.log('Deleted keys:', keys);
  } else {
    console.log('No menu keys found to delete.');
  }

  process.exit(0);
}
test().catch(err => {
  console.error(err);
  process.exit(1);
});
