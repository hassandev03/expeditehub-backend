const cron = require('node-cron');
const Order = require('../modules/orders/order.model');
const { emitDelayedOrderAlert } = require('../sockets/socketManager');

function startDelayedOrderAlertCronJob() {
  // Fires every 2 minutes; alerts the chef room for any order stuck in Preparing > 15 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      const overdueOrderCutoffTime = new Date(Date.now() - 15 * 60 * 1000);

      const overdueOrders = await Order.find({
        status: 'Preparing',
        updatedAt: { $lt: overdueOrderCutoffTime }
      }).select('_id tenantId');

      for (const overdueOrder of overdueOrders) {
        emitDelayedOrderAlert(overdueOrder.tenantId.toString(), overdueOrder._id.toString());
      }

      if (overdueOrders.length > 0) {
        console.log(
          `[${new Date().toISOString()}] Delayed order alerts emitted: ${overdueOrders.length}`
        );
      }
    } catch (cronJobError) {
      console.error('Failed to execute delayed order alert check:', cronJobError.message);
    }
  });
}

module.exports = { startDelayedOrderAlertCronJob };
