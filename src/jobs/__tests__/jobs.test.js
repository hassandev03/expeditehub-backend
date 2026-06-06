// Capture cron callbacks for manual invocation in tests
const capturedCronCallbacks = {};

jest.mock('node-cron', () => ({
  schedule: jest.fn((cronExpression, callbackFunction) => {
    capturedCronCallbacks[cronExpression] = callbackFunction;
  })
}));

jest.mock('../../../config/redis', () => ({
  redisClient: {
    keys: jest.fn().mockResolvedValue([]),
    del: jest.fn().mockResolvedValue(0)
  }
}));

jest.mock('../../sockets/socketManager', () => ({
  emitDelayedOrderAlert: jest.fn()
}));

jest.mock('../../modules/orders/order.model', () => ({
  find: jest.fn().mockReturnValue({
    select: jest.fn().mockResolvedValue([])
  })
}));

const { startMidnightResetCronJobs } = require('../midnightReset');
const { startDelayedOrderAlertCronJob } = require('../delayedOrderAlert');
const { redisClient } = require('../../../config/redis');
const { emitDelayedOrderAlert } = require('../../sockets/socketManager');
const Order = require('../../modules/orders/order.model');

describe('Background Jobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisClient.keys.mockResolvedValue([]);
    redisClient.del.mockResolvedValue(0);
  });

  // ── midnightReset ──────────────────────────────────────────────────────

  describe('midnightReset — startMidnightResetCronJobs', () => {
    beforeEach(() => {
      startMidnightResetCronJobs();
    });

    it('registers three cron schedules (daily, weekly, monthly)', () => {
      const cron = require('node-cron');
      expect(cron.schedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function));
      expect(cron.schedule).toHaveBeenCalledWith('0 0 * * 1', expect.any(Function));
      expect(cron.schedule).toHaveBeenCalledWith('0 0 1 * *', expect.any(Function));
    });

    it('daily job deletes revenue:daily:* and orders:daily:* keys', async () => {
      redisClient.keys
        .mockResolvedValueOnce(['revenue:daily:tenant1:2026-01-01']) // daily revenue
        .mockResolvedValueOnce(['orders:daily:tenant1:2026-01-01']); // daily orders

      const dailyCallback = capturedCronCallbacks['0 0 * * *'];
      await dailyCallback();

      expect(redisClient.del).toHaveBeenCalledWith(
        'revenue:daily:tenant1:2026-01-01',
        'orders:daily:tenant1:2026-01-01'
      );
    });

    it('daily job does not call del when no keys exist', async () => {
      redisClient.keys.mockResolvedValue([]);

      const dailyCallback = capturedCronCallbacks['0 0 * * *'];
      await dailyCallback();

      expect(redisClient.del).not.toHaveBeenCalled();
    });

    it('weekly job deletes revenue:weekly:* and orders:weekly:* keys', async () => {
      redisClient.keys
        .mockResolvedValueOnce(['revenue:weekly:tenant1:2026-01'])
        .mockResolvedValueOnce(['orders:weekly:tenant1:2026-01']);

      const weeklyCallback = capturedCronCallbacks['0 0 * * 1'];
      await weeklyCallback();

      expect(redisClient.del).toHaveBeenCalledWith(
        'revenue:weekly:tenant1:2026-01',
        'orders:weekly:tenant1:2026-01'
      );
    });

    it('monthly job deletes revenue:monthly:* and orders:monthly:* keys', async () => {
      redisClient.keys
        .mockResolvedValueOnce(['revenue:monthly:tenant1:2026-01'])
        .mockResolvedValueOnce(['orders:monthly:tenant1:2026-01']);

      const monthlyCallback = capturedCronCallbacks['0 0 1 * *'];
      await monthlyCallback();

      expect(redisClient.del).toHaveBeenCalledWith(
        'revenue:monthly:tenant1:2026-01',
        'orders:monthly:tenant1:2026-01'
      );
    });
  });

  // ── delayedOrderAlert ─────────────────────────────────────────────────

  describe('delayedOrderAlert — startDelayedOrderAlertCronJob', () => {
    beforeEach(() => {
      startDelayedOrderAlertCronJob();
    });

    it('registers a cron schedule that fires every 2 minutes', () => {
      const cron = require('node-cron');
      expect(cron.schedule).toHaveBeenCalledWith('*/2 * * * *', expect.any(Function));
    });

    it('does not emit alerts when no overdue orders exist', async () => {
      Order.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });

      const alertCallback = capturedCronCallbacks['*/2 * * * *'];
      await alertCallback();

      expect(emitDelayedOrderAlert).not.toHaveBeenCalled();
    });

    it('emits delayed alert for each overdue Preparing order', async () => {
      const overdueOrders = [
        { _id: { toString: () => 'order-id-1' }, tenantId: { toString: () => 'tenant-id-1' } },
        { _id: { toString: () => 'order-id-2' }, tenantId: { toString: () => 'tenant-id-2' } }
      ];
      Order.find.mockReturnValue({ select: jest.fn().mockResolvedValue(overdueOrders) });

      const alertCallback = capturedCronCallbacks['*/2 * * * *'];
      await alertCallback();

      expect(emitDelayedOrderAlert).toHaveBeenCalledTimes(2);
      expect(emitDelayedOrderAlert).toHaveBeenCalledWith('tenant-id-1', 'order-id-1');
      expect(emitDelayedOrderAlert).toHaveBeenCalledWith('tenant-id-2', 'order-id-2');
    });

    it('queries only Preparing orders with updatedAt older than 15 minutes', async () => {
      Order.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });

      const beforeCallTime = Date.now();
      const alertCallback = capturedCronCallbacks['*/2 * * * *'];
      await alertCallback();

      const findCallArg = Order.find.mock.calls[0][0];
      expect(findCallArg.status).toBe('Preparing');
      expect(findCallArg.updatedAt.$lt.getTime()).toBeLessThanOrEqual(beforeCallTime - 15 * 60 * 1000);
    });
  });
});
