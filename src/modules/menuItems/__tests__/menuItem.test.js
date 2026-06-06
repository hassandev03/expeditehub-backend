jest.mock('../../../../config/redis', () => ({
  redisClient: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1)
  }
}));

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
const {
  startTestDatabase,
  stopTestDatabase,
  clearTestDatabaseCollections
} = require('../../../tests/databaseTestHelper');
const { emitMenuInvalidation, emitItemUnavailable } = require('../../../sockets/socketManager');

process.env.ACCESS_TOKEN_SECRET = 'test-access-secret-menuitem-tests';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-menuitem-tests';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';

// ─── Helpers ───────────────────────────────────────────────────────────────

async function seedTestEnvironment() {
  const savedTenant = await new Tenant({
    name: 'MenuItem Test Restaurant',
    address: '1 MenuItem Street',
    contactEmail: 'menuitem-test@restaurant.com'
  }).save();

  const hashedPassword = await bcrypt.hash('adminpassword', 10);
  const savedAdmin = await new Employee({
    tenantId: savedTenant._id,
    fullName: 'Menu Admin',
    email: 'menuadmin@restaurant.com',
    password: hashedPassword,
    role: 'admin',
    isActive: true
  }).save();

  const savedChef = await new Employee({
    tenantId: savedTenant._id,
    fullName: 'Test Chef',
    email: 'testchef@restaurant.com',
    password: hashedPassword,
    role: 'chef',
    isActive: true
  }).save();

  const adminToken = jwt.sign(
    { sub: savedAdmin._id.toString(), tenantId: savedTenant._id.toString(), role: 'admin', jti: 'admin-jti' },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: '15m' }
  );

  const chefToken = jwt.sign(
    { sub: savedChef._id.toString(), tenantId: savedTenant._id.toString(), role: 'chef', jti: 'chef-jti' },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: '15m' }
  );

  return { savedTenant, savedAdmin, savedChef, adminToken, chefToken };
}

const validMenuItemPayload = {
  name: 'Margherita Pizza',
  description: 'Classic tomato and mozzarella',
  price: 15.99,
  category: 'Pizza',
  isAvailable: true
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe('MenuItem Module', () => {
  let testEnv;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    testEnv = await seedTestEnvironment();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await clearTestDatabaseCollections();
  });

  // ── POST /api/v1/menu-items ────────────────────────────────────────────

  describe('POST /api/v1/menu-items', () => {
    it('creates a menu item and returns 201', async () => {
      const response = await request(app)
        .post('/api/v1/menu-items')
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send(validMenuItemPayload);

      expect(response.status).toBe(201);
      expect(response.body.menuItem.name).toBe('Margherita Pizza');
      expect(response.body.menuItem.price).toBe(15.99);
    });

    it('returns 400 when price is missing', async () => {
      const { price: _omitted, ...payloadWithoutPrice } = validMenuItemPayload;

      const response = await request(app)
        .post('/api/v1/menu-items')
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send(payloadWithoutPrice);

      expect(response.status).toBe(400);
    });

    it('returns 400 when price is zero or negative', async () => {
      const response = await request(app)
        .post('/api/v1/menu-items')
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send({ ...validMenuItemPayload, price: -5 });

      expect(response.status).toBe(400);
    });

    it('returns 403 when chef tries to create a menu item', async () => {
      const response = await request(app)
        .post('/api/v1/menu-items')
        .set('Authorization', `Bearer ${testEnv.chefToken}`)
        .send(validMenuItemPayload);

      expect(response.status).toBe(403);
    });
  });

  // ── GET /api/v1/menu-items ─────────────────────────────────────────────

  describe('GET /api/v1/menu-items', () => {
    it('returns all menu items for the tenant', async () => {
      await request(app)
        .post('/api/v1/menu-items')
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send(validMenuItemPayload);

      const response = await request(app)
        .get('/api/v1/menu-items')
        .set('Authorization', `Bearer ${testEnv.adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.menuItems).toBeDefined();
      expect(response.body.menuItems.length).toBe(1);
    });

    it('chef can access menu items', async () => {
      const response = await request(app)
        .get('/api/v1/menu-items')
        .set('Authorization', `Bearer ${testEnv.chefToken}`);

      expect(response.status).toBe(200);
    });
  });

  // ── PUT /api/v1/menu-items/:id ─────────────────────────────────────────

  describe('PUT /api/v1/menu-items/:id', () => {
    it('updates a menu item and emits menu invalidation when price changes', async () => {
      const createResponse = await request(app)
        .post('/api/v1/menu-items')
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send(validMenuItemPayload);

      const menuItemId = createResponse.body.menuItem._id;

      const response = await request(app)
        .put(`/api/v1/menu-items/${menuItemId}`)
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send({ price: 19.99 });

      expect(response.status).toBe(200);
      expect(response.body.menuItem.price).toBe(19.99);
      expect(emitMenuInvalidation).toHaveBeenCalledWith(testEnv.savedTenant._id.toString());
    });

    it('does not emit menu invalidation when price does not change', async () => {
      const createResponse = await request(app)
        .post('/api/v1/menu-items')
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send(validMenuItemPayload);

      const menuItemId = createResponse.body.menuItem._id;

      await request(app)
        .put(`/api/v1/menu-items/${menuItemId}`)
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send({ name: 'Updated Pizza Name' });

      expect(emitMenuInvalidation).not.toHaveBeenCalled();
    });

    it('returns 404 when menu item does not exist', async () => {
      const response = await request(app)
        .put('/api/v1/menu-items/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send({ name: 'Updated' });

      expect(response.status).toBe(404);
    });
  });

  // ── PATCH /api/v1/menu-items/:id/availability ──────────────────────────

  describe('PATCH /api/v1/menu-items/:id/availability', () => {
    it('chef marking item unavailable emits item_unavailable socket event', async () => {
      const createResponse = await request(app)
        .post('/api/v1/menu-items')
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send(validMenuItemPayload);

      const menuItemId = createResponse.body.menuItem._id;

      const response = await request(app)
        .patch(`/api/v1/menu-items/${menuItemId}/availability`)
        .set('Authorization', `Bearer ${testEnv.chefToken}`)
        .send({ isAvailable: false });

      expect(response.status).toBe(200);
      expect(emitItemUnavailable).toHaveBeenCalledWith(
        testEnv.savedTenant._id.toString(),
        menuItemId,
        'Margherita Pizza'
      );
    });

    it('admin marking item unavailable does NOT emit item_unavailable socket event', async () => {
      const createResponse = await request(app)
        .post('/api/v1/menu-items')
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send(validMenuItemPayload);

      const menuItemId = createResponse.body.menuItem._id;

      await request(app)
        .patch(`/api/v1/menu-items/${menuItemId}/availability`)
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send({ isAvailable: false });

      expect(emitItemUnavailable).not.toHaveBeenCalled();
    });

    it('returns 400 when isAvailable is not a boolean', async () => {
      const createResponse = await request(app)
        .post('/api/v1/menu-items')
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send(validMenuItemPayload);

      const menuItemId = createResponse.body.menuItem._id;

      const response = await request(app)
        .patch(`/api/v1/menu-items/${menuItemId}/availability`)
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send({ isAvailable: 'yes' });

      expect(response.status).toBe(400);
    });
  });

  // ── DELETE /api/v1/menu-items/:id ─────────────────────────────────────

  describe('DELETE /api/v1/menu-items/:id', () => {
    it('deletes a menu item and returns 200', async () => {
      const createResponse = await request(app)
        .post('/api/v1/menu-items')
        .set('Authorization', `Bearer ${testEnv.adminToken}`)
        .send(validMenuItemPayload);

      const menuItemId = createResponse.body.menuItem._id;

      const response = await request(app)
        .delete(`/api/v1/menu-items/${menuItemId}`)
        .set('Authorization', `Bearer ${testEnv.adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Menu item deleted');
    });

    it('returns 404 when menu item does not exist', async () => {
      const response = await request(app)
        .delete('/api/v1/menu-items/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${testEnv.adminToken}`);

      expect(response.status).toBe(404);
    });
  });
});
