const Redis = require('ioredis');

const redisClient = new Redis(process.env.REDIS_URL, {
  family: 0,
});

redisClient.on('connect', () => console.log('Redis connected successfully'));
redisClient.on('error', (redisConnectionError) => {
  console.error('Redis connection error:', redisConnectionError.message);
});

module.exports = { redisClient };
