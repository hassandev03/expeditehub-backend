jest.mock('../../../../config/redis', () => {
  const mockPipeline = {
    incrbyfloat: jest.fn().mockReturnThis(),
    incr: jest.fn().mockReturnThis(),
    get: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([])
  };
  return {
    redisClient: {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      pipeline: jest.fn().mockReturnValue(mockPipeline)
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
const MenuItem = require('../../menuItems/menuItem.model');
const Order = require('../order.model');
const {
  startTestDatabase,
  stopTestDatabase,
  clearTestDatabaseCollections
} = require('../../../tests/databaseTestHelper');
const { redisClient } = require('../../../../config/redis');
const { emitNewOrder, emitOrderReady } = require('../../../sockets/socketManager');

process.env.ACCESS_TOKEN_SECRET = 'test-access-secret-order-tests';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-order-tests';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';

// ─── Helpers ───────────────────────────────────────────────────────────────

async function seedOrderTestEnvironment() {
  const savedTenant = await new Tenant({
    name: 'Order Test Restaurant',
    address: '1 Order Street',
    contactEmail: 'order-test@restaurant.com'
  }).save();

  const hashedPassword = await bcrypt.hash('password123', 10);

  const savedCashier = await new Employee({
    tenantId: savedTenant._id,
    fullName: 'Test Cashier',
    email: 'cashier@restaurant.com',
    password: hashedPassword,
    role: 'cashier',
    isActive: true
  }).save();

  const savedChef = await new Employee({
    tenantId: savedTenant._id,
    fullName: 'Test Chef',
    email: 'chef@restaurant.com',
    password: hashedPassword,
    role: 'chef',
    isActive: true
  }).save();

  const savedAdmin = await new Employee({
    tenantId: savedTenant._id,
    fullName: 'Test Admin',
    email: 'admin@restaurant.com',
    password: hashedPassword,
    role: 'admin',
    isActive: true
  }).save();

  const savedMenuItem = await new MenuItem({
    tenantId: savedTenant._id,
    name: 'Chicken Burger',
    description: 'Crispy chicken patty',
    price: 12.5,
    category: 'Burgers',
    isAvailable: true
  }).save();

  const savedUnavailableMenuItem = await new MenuItem({
    tenantId: savedTenant._id,
    name: 'Sold Out Item',
    price: 5.0,
    category: 'Snacks',
    isAvailable: false
  }).save();

  function buildToken(employee) {
    return jwt.sign(
      {
        sub: employee._id.toString(),
        tenantId: savedTenant._id.toString(),
        role: employee.role,
        jti: `${employee.role}-jti`
      },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: '15m' }
    );
  }

  return {
    savedTenant,
    savedCashier,
    savedChef,
    savedAdmin,
    savedMenuItem,
    savedUnavailableMenuItem,
    cashierToken: buildToken(savedCashier),
    chefToken: buildToken(savedChef),
    adminToken: buildToken(savedAdmin)
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Order Module', () => {
  let testEnv;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    testEnv = await seedOrderTestEnvironment();
    jest.clearAllMocks();
    redisClient.incr.mockResolvedValue(1);
  });

  afterEach(async () => {
    await clearTestDatabaseCollections();
  });

  // ── POST /api/v1/orders ────────────────────────────────────────────────

  describe('POST /api/v1/orders', () => {
    it('creates an order with snapshotted item data and returns 201', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`)
        .send({
          items: [{ menuItemId: testEnv.savedMenuItem._id, quantity: 2 }]
        });

      expect(response.status).toBe(201);
      expect(response.body.order.orderNumber).toBe(1);
      expect(response.body.order.status).toBe('Received');
      expect(response.body.order.totalAmount).toBe(25); // 12.50 * 2
      expect(response.body.order.items[0].name).toBe('Chicken Burger');
      expect(response.body.order.items[0].price).toBe(12.5);
    });

    it('emits new_order socket event after creating an order', async () => {
      await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`)
        .send({ items: [{ menuItemId: testEnv.savedMenuItem._id, quantity: 1 }] });

      expect(emitNewOrder).toHaveBeenCalledWith(
        testEnv.savedTenant._id.toString(),
        expect.objectContaining({ status: 'Received' })
      );
    });

    it('returns 400 when items array is empty', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`)
        .send({ items: [] });

      expect(response.status).toBe(400);
    });

    it('returns 400 when a menu item is not found in this tenant', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`)
        .send({ items: [{ menuItemId: '507f1f77bcf86cd799439011', quantity: 1 }] });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/not found/i);
    });

    it('returns 400 with item names when a menu item is unavailable', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`)
        .send({ items: [{ menuItemId: testEnv.savedUnavailableMenuItem._id, quantity: 1 }] });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Sold Out Item');
    });

    it('returns 403 when a non-cashier tries to create an order', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.chefToken}`)
        .send({ items: [{ menuItemId: testEnv.savedMenuItem._id, quantity: 1 }] });

      expect(response.status).toBe(403);
    });
  });

  // ── GET /api/v1/orders ─────────────────────────────────────────────────

  describe('GET /api/v1/orders (active orders for chef)', () => {
    it('returns only non-Paid orders sorted oldest first', async () => {
      await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`)
        .send({ items: [{ menuItemId: testEnv.savedMenuItem._id, quantity: 1 }] });

      const response = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.chefToken}`);

      expect(response.status).toBe(200);
      expect(response.body.orders).toBeDefined();
      expect(response.body.orders.length).toBe(1);
      expect(response.body.orders[0].status).toBe('Received');
    });

    it('returns 403 when a cashier tries to list active orders', async () => {
      const response = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`);

      expect(response.status).toBe(403);
    });
  });

  // ── GET /api/v1/orders/history ─────────────────────────────────────────

  describe('GET /api/v1/orders/history', () => {
    it('returns paginated order history with total count', async () => {
      await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`)
        .send({ items: [{ menuItemId: testEnv.savedMenuItem._id, quantity: 1 }] });

      const response = await request(app)
        .get('/api/v1/orders/history')
        .set('Authorization', `Bearer ${testEnv.adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.orders).toBeDefined();
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(20);
      expect(response.body.total).toBe(1);
    });
  });

  // ── PATCH /api/v1/orders/:id/status ───────────────────────────────────

  describe('PATCH /api/v1/orders/:id/status', () => {
    it('transitions Received → Preparing successfully and assigns chefId', async () => {
      const createResponse = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`)
        .send({ items: [{ menuItemId: testEnv.savedMenuItem._id, quantity: 1 }] });

      const orderId = createResponse.body.order._id;

      const response = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${testEnv.chefToken}`)
        .send({ status: 'Preparing' });

      expect(response.status).toBe(200);
      expect(response.body.order.status).toBe('Preparing');
      expect(response.body.order.chefId).toBe(testEnv.savedChef._id.toString());
    });

    it('transitions Preparing → Ready and emits order_ready socket event', async () => {
      const createResponse = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`)
        .send({ items: [{ menuItemId: testEnv.savedMenuItem._id, quantity: 1 }] });

      const orderId = createResponse.body.order._id;

      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${testEnv.chefToken}`)
        .send({ status: 'Preparing' });

      const response = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${testEnv.chefToken}`)
        .send({ status: 'Ready' });

      expect(response.status).toBe(200);
      expect(response.body.order.status).toBe('Ready');
      expect(emitOrderReady).toHaveBeenCalledWith(
        testEnv.savedTenant._id.toString(),
        expect.objectContaining({ status: 'Ready' })
      );
    });

    it('returns 400 for invalid state machine transition (Received → Ready)', async () => {
      const createResponse = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`)
        .send({ items: [{ menuItemId: testEnv.savedMenuItem._id, quantity: 1 }] });

      const orderId = createResponse.body.order._id;

      const response = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${testEnv.chefToken}`)
        .send({ status: 'Ready' }); // skips Preparing

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/Cannot transition/i);
    });

    it('returns 400 when status value is invalid (e.g. Paid)', async () => {
      const createResponse = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`)
        .send({ items: [{ menuItemId: testEnv.savedMenuItem._id, quantity: 1 }] });

      const orderId = createResponse.body.order._id;

      const response = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${testEnv.chefToken}`)
        .send({ status: 'Paid' });

      expect(response.status).toBe(400);
    });
  });

  // ── PATCH /api/v1/orders/:id/pay ──────────────────────────────────────

  describe('PATCH /api/v1/orders/:id/pay', () => {
    it('marks a Ready order as Paid and fires Redis analytics pipeline', async () => {
      const createResponse = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`)
        .send({ items: [{ menuItemId: testEnv.savedMenuItem._id, quantity: 1 }] });

      const orderId = createResponse.body.order._id;

      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${testEnv.chefToken}`)
        .send({ status: 'Preparing' });

      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${testEnv.chefToken}`)
        .send({ status: 'Ready' });

      const response = await request(app)
        .patch(`/api/v1/orders/${orderId}/pay`)
        .set('Authorization', `Bearer ${testEnv.cashierToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Order marked as paid');
      expect(response.body.order.status).toBe('Paid');
      // Verify pipeline was called
      expect(redisClient.pipeline).toHaveBeenCalled();
    });

    it('returns 400 when order is not in Ready status', async () => {
      const createResponse = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`)
        .send({ items: [{ menuItemId: testEnv.savedMenuItem._id, quantity: 1 }] });

      const orderId = createResponse.body.order._id; // status is Received

      const response = await request(app)
        .patch(`/api/v1/orders/${orderId}/pay`)
        .set('Authorization', `Bearer ${testEnv.cashierToken}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/Ready/i);
    });

    it('returns 404 when order does not exist', async () => {
      const response = await request(app)
        .patch('/api/v1/orders/507f1f77bcf86cd799439011/pay')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`);

      expect(response.status).toBe(404);
    });

    it('still returns 200 when Redis pipeline fails (MongoDB is source of truth)', async () => {
      const createResponse = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${testEnv.cashierToken}`)
        .send({ items: [{ menuItemId: testEnv.savedMenuItem._id, quantity: 1 }] });

      const orderId = createResponse.body.order._id;

      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${testEnv.chefToken}`)
        .send({ status: 'Preparing' });

      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${testEnv.chefToken}`)
        .send({ status: 'Ready' });

      // Make the pipeline's exec fail
      redisClient.pipeline.mockReturnValueOnce({
        incrbyfloat: jest.fn().mockReturnThis(),
        incr: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('Redis connection lost'))
      });

      const response = await request(app)
        .patch(`/api/v1/orders/${orderId}/pay`)
        .set('Authorization', `Bearer ${testEnv.cashierToken}`);

      // Must still succeed — MongoDB has committed the Paid state
      expect(response.status).toBe(200);

      // Verify the order is actually Paid in MongoDB
      const savedOrder = await Order.findById(orderId);
      expect(savedOrder.status).toBe('Paid');
    });
  });
});
