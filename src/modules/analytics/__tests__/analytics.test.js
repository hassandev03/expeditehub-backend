jest.mock('../../../../config/redis', () => {
  const mockPipeline = {
    get: jest.fn().mockReturnThis(),
    exec: jest.fn()
  };
  return {
    redisClient: {
      keys: jest.fn().mockResolvedValue([]),
      pipeline: jest.fn().mockReturnValue(mockPipeline),
      get: jest.fn().mockResolvedValue(null)
    }
  };
});

jest.mock('../../../sockets/socketManager', () => ({
  initSocket: jest.fn(),
  emitNewOrder: jest.fn(),
  emitOrderReady: jest.fn(),
  emitItemUnavailable: jest.fn(),
  emitMenuInvalidation: jest.fn(),
  emitDelayedOrderAlert: jest.fn()
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = require('../../../../app');
const Tenant = require('../../tenants/tenant.model');
const Employee = require('../../employees/employee.model');
const Order = require('../../orders/order.model');
const {
  startTestDatabase,
  stopTestDatabase,
  clearTestDatabaseCollections
} = require('../../../tests/databaseTestHelper');
const { redisClient } = require('../../../../config/redis');

process.env.ACCESS_TOKEN_SECRET = 'test-access-secret-analytics-tests';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-analytics-tests';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';

async function seedAnalyticsTestEnvironment() {
  const savedTenant = await new Tenant({
    name: 'Analytics Test Restaurant',
    address: '1 Analytics Street',
    contactEmail: 'analytics-test@restaurant.com'
  }).save();

  const hashedPassword = await bcrypt.hash('password123', 10);
  const savedAdmin = await new Employee({
    tenantId: savedTenant._id,
    fullName: 'Analytics Admin',
    email: 'analyticsadmin@restaurant.com',
    password: hashedPassword,
    role: 'admin',
    isActive: true
  }).save();

  const adminToken = jwt.sign(
    { sub: savedAdmin._id.toString(), tenantId: savedTenant._id.toString(), role: 'admin', jti: 'admin-jti-analytics' },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: '15m' }
  );

  return { savedTenant, savedAdmin, adminToken };
}

describe('Analytics Module', () => {
  let testEnv;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    testEnv = await seedAnalyticsTestEnvironment();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await clearTestDatabaseCollections();
  });

  // ── GET /api/v1/analytics/summary ─────────────────────────────────────

  describe('GET /api/v1/analytics/summary', () => {
    it('returns summary with zeros when no Redis data exists', async () => {
      redisClient.pipeline.mockReturnValue({
        get: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, null],
          [null, null],
          [null, null],
          [null, null],
          [null, null],
          [null, null]
        ])
      });

      const response = await request(app)
        .get('/api/v1/analytics/summary')
        .set('Authorization', `Bearer ${testEnv.adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.today.revenue).toBe(0);
      expect(response.body.today.orders).toBe(0);
      expect(response.body.week.revenue).toBe(0);
      expect(response.body.month.orders).toBe(0);
    });

    it('returns parsed numeric values when Redis data is present', async () => {
      redisClient.pipeline.mockReturnValue({
        get: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, '1500.50'],  // daily revenue
          [null, '10'],       // daily orders
          [null, '8000.00'],  // weekly revenue
          [null, '50'],       // weekly orders
          [null, '25000.00'], // monthly revenue
          [null, '150']       // monthly orders
        ])
      });

      const response = await request(app)
        .get('/api/v1/analytics/summary')
        .set('Authorization', `Bearer ${testEnv.adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.today.revenue).toBe(1500.5);
      expect(response.body.today.orders).toBe(10);
      expect(response.body.week.revenue).toBe(8000.0);
      expect(response.body.month.orders).toBe(150);
    });
  });

  // ── GET /api/v1/analytics/by-category ────────────────────────────────

  describe('GET /api/v1/analytics/by-category', () => {
    it('returns empty array when no category keys exist in Redis', async () => {
      redisClient.keys.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/analytics/by-category')
        .set('Authorization', `Bearer ${testEnv.adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.categories).toEqual([]);
    });

    it('returns category revenue data when Redis keys are found', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const tenantId = testEnv.savedTenant._id.toString();

      redisClient.keys.mockResolvedValue([
        `revenue:category:${tenantId}:Burgers:${today}`,
        `revenue:category:${tenantId}:Pizza:${today}`
      ]);

      redisClient.pipeline.mockReturnValue({
        get: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, '250.00'],
          [null, '180.50']
        ])
      });

      const response = await request(app)
        .get('/api/v1/analytics/by-category')
        .set('Authorization', `Bearer ${testEnv.adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.categories).toHaveLength(2);
      const categoryNames = response.body.categories.map((category) => category.name);
      expect(categoryNames).toContain('Burgers');
      expect(categoryNames).toContain('Pizza');
    });
  });

  // ── GET /api/v1/analytics/by-cashier ─────────────────────────────────

  describe('GET /api/v1/analytics/by-cashier', () => {
    it('returns empty array when no cashier keys exist in Redis', async () => {
      redisClient.keys.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/analytics/by-cashier')
        .set('Authorization', `Bearer ${testEnv.adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.cashiers).toEqual([]);
    });
  });

  // ── GET /api/v1/analytics/by-chef ─────────────────────────────────────

  describe('GET /api/v1/analytics/by-chef', () => {
    it('returns empty array when no chef keys exist in Redis', async () => {
      redisClient.keys.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/analytics/by-chef')
        .set('Authorization', `Bearer ${testEnv.adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.chefs).toEqual([]);
    });
  });

  // ── GET /api/v1/analytics/active-orders-count ─────────────────────────

  describe('GET /api/v1/analytics/active-orders-count', () => {
    it('returns count of 0 when no active orders exist', async () => {
      const response = await request(app)
        .get('/api/v1/analytics/active-orders-count')
        .set('Authorization', `Bearer ${testEnv.adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(0);
    });

    it('returns correct count from MongoDB (not Redis)', async () => {
      const hashedPassword = await bcrypt.hash('cashierpass', 10);
      const cashier = await new Employee({
        tenantId: testEnv.savedTenant._id,
        fullName: 'Count Cashier',
        email: 'countcashier@restaurant.com',
        password: hashedPassword,
        role: 'cashier',
        isActive: true
      }).save();

      // Create 2 active orders directly in MongoDB
      await Order.insertMany([
        {
          tenantId: testEnv.savedTenant._id,
          orderNumber: 1,
          items: [{ menuItemId: '507f1f77bcf86cd799439011', name: 'Item A', price: 10, category: 'Cat', quantity: 1 }],
          totalAmount: 10,
          status: 'Received',
          cashierId: cashier._id
        },
        {
          tenantId: testEnv.savedTenant._id,
          orderNumber: 2,
          items: [{ menuItemId: '507f1f77bcf86cd799439011', name: 'Item B', price: 20, category: 'Cat', quantity: 1 }],
          totalAmount: 20,
          status: 'Preparing',
          cashierId: cashier._id
        }
      ]);

      const response = await request(app)
        .get('/api/v1/analytics/active-orders-count')
        .set('Authorization', `Bearer ${testEnv.adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(2);
    });

    it('returns 403 when a non-admin tries to access analytics', async () => {
      const hashedPassword = await bcrypt.hash('cashierpass', 10);
      const cashier = await new Employee({
        tenantId: testEnv.savedTenant._id,
        fullName: 'Cashier Test',
        email: 'cashiertest@restaurant.com',
        password: hashedPassword,
        role: 'cashier',
        isActive: true
      }).save();

      const cashierToken = jwt.sign(
        { sub: cashier._id.toString(), tenantId: testEnv.savedTenant._id.toString(), role: 'cashier', jti: 'cashier-jti' },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: '15m' }
      );

      const response = await request(app)
        .get('/api/v1/analytics/active-orders-count')
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(response.status).toBe(403);
    });
  });
});
