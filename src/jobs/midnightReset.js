const cron = require('node-cron');
const { redisClient } = require('../../config/redis');

function startMidnightResetCronJobs() {
  // Daily reset at midnight — clears daily revenue and order count keys
  cron.schedule('0 0 * * *', async () => {
    try {
      const dailyRevenueKeys = await redisClient.keys('revenue:daily:*');
      const dailyOrderCountKeys = await redisClient.keys('orders:daily:*');
      const allDailyKeysToDelete = [...dailyRevenueKeys, ...dailyOrderCountKeys];

      if (allDailyKeysToDelete.length > 0) {
        await redisClient.del(...allDailyKeysToDelete);
      }

      console.log(
        `[${new Date().toISOString()}] Daily Redis reset: deleted ${allDailyKeysToDelete.length} keys`
      );
    } catch (redisResetError) {
      console.error('Failed to execute daily Redis reset:', redisResetError.message);
    }
  });

  // Weekly reset every Monday at midnight — clears weekly revenue and order count keys
  cron.schedule('0 0 * * 1', async () => {
    try {
      const weeklyRevenueKeys = await redisClient.keys('revenue:weekly:*');
      const weeklyOrderCountKeys = await redisClient.keys('orders:weekly:*');
      const allWeeklyKeysToDelete = [...weeklyRevenueKeys, ...weeklyOrderCountKeys];

      if (allWeeklyKeysToDelete.length > 0) {
        await redisClient.del(...allWeeklyKeysToDelete);
      }

      console.log(
        `[${new Date().toISOString()}] Weekly Redis reset: deleted ${allWeeklyKeysToDelete.length} keys`
      );
    } catch (redisResetError) {
      console.error('Failed to execute weekly Redis reset:', redisResetError.message);
    }
  });

  // Monthly reset on the 1st of every month at midnight — clears monthly revenue and order count keys
  cron.schedule('0 0 1 * *', async () => {
    try {
      const monthlyRevenueKeys = await redisClient.keys('revenue:monthly:*');
      const monthlyOrderCountKeys = await redisClient.keys('orders:monthly:*');
      const allMonthlyKeysToDelete = [...monthlyRevenueKeys, ...monthlyOrderCountKeys];

      if (allMonthlyKeysToDelete.length > 0) {
        await redisClient.del(...allMonthlyKeysToDelete);
      }

      console.log(
        `[${new Date().toISOString()}] Monthly Redis reset: deleted ${allMonthlyKeysToDelete.length} keys`
      );
    } catch (redisResetError) {
      console.error('Failed to execute monthly Redis reset:', redisResetError.message);
    }
  });
}

module.exports = { startMidnightResetCronJobs };
