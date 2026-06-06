jest.mock('../../../../config/redis', () => ({
  redisClient: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK')
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
const Employee = require('../employee.model');
const {
  startTestDatabase,
  stopTestDatabase,
  clearTestDatabaseCollections
} = require('../../../tests/databaseTestHelper');

process.env.ACCESS_TOKEN_SECRET = 'test-access-secret-employee-tests';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-employee-tests';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';

// ─── Helpers ───────────────────────────────────────────────────────────────

async function createTestTenant(overrides = {}) {
  return new Tenant({
    name: 'Employee Test Restaurant',
    address: '1 Employee Street',
    contactEmail: `emp-test-${Date.now()}@restaurant.com`,
    ...overrides
  }).save();
}

async function createTestAdmin(tenantId, overrides = {}) {
  const hashedPassword = await bcrypt.hash('adminpassword123', 10);
  return new Employee({
    tenantId,
    fullName: 'Test Admin',
    email: `admin-${Date.now()}@restaurant.com`,
    password: hashedPassword,
    role: 'admin',
    isActive: true,
    ...overrides
  }).save();
}

function buildAdminToken(adminEmployee, tenantId) {
  return jwt.sign(
    {
      sub: adminEmployee._id.toString(),
      tenantId: tenantId.toString(),
      role: 'admin',
      jti: 'test-jti-employee'
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: '15m' }
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Employee Module', () => {
  let testTenant;
  let testAdmin;
  let adminToken;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    testTenant = await createTestTenant();
    testAdmin = await createTestAdmin(testTenant._id);
    adminToken = buildAdminToken(testAdmin, testTenant._id);
  });

  afterEach(async () => {
    await clearTestDatabaseCollections();
  });

  // ── POST /api/v1/employees ─────────────────────────────────────────────

  describe('POST /api/v1/employees', () => {
    it('creates a chef employee and returns 201 without password', async () => {
      const response = await request(app)
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: 'Chef Gordon',
          email: 'chef@restaurant.com',
          password: 'chefpass123',
          role: 'chef'
        });

      expect(response.status).toBe(201);
      expect(response.body.employee.fullName).toBe('Chef Gordon');
      expect(response.body.employee.role).toBe('chef');
      expect(response.body.employee.password).toBeUndefined();
    });

    it('creates a cashier employee', async () => {
      const response = await request(app)
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: 'Cashier Bob',
          email: 'cashier@restaurant.com',
          password: 'cashierpass123',
          role: 'cashier'
        });

      expect(response.status).toBe(201);
      expect(response.body.employee.role).toBe('cashier');
    });

    it('returns 400 when role is admin (cannot create admin via this endpoint)', async () => {
      const response = await request(app)
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: 'Another Admin',
          email: 'admin2@restaurant.com',
          password: 'adminpass123',
          role: 'admin'
        });

      expect(response.status).toBe(400);
    });

    it('returns 409 when email already exists within the same tenant', async () => {
      await request(app)
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullName: 'Chef One', email: 'duplicate@restaurant.com', password: 'pass123', role: 'chef' });

      const response = await request(app)
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullName: 'Chef Two', email: 'duplicate@restaurant.com', password: 'pass456', role: 'cashier' });

      expect(response.status).toBe(409);
    });

    it('returns 403 when called without admin token', async () => {
      const chefToken = jwt.sign(
        { sub: 'someone', tenantId: testTenant._id.toString(), role: 'chef', jti: 'jti-chef' },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: '15m' }
      );

      const response = await request(app)
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${chefToken}`)
        .send({ fullName: 'Test', email: 'test@test.com', password: 'pass123', role: 'chef' });

      expect(response.status).toBe(403);
    });

    it('returns 401 when no Authorization header is present', async () => {
      const response = await request(app).post('/api/v1/employees').send({
        fullName: 'Test',
        email: 'test@test.com',
        password: 'pass123',
        role: 'chef'
      });

      expect(response.status).toBe(401);
    });
  });

  // ── GET /api/v1/employees ──────────────────────────────────────────────

  describe('GET /api/v1/employees', () => {
    it('returns all employees for the tenant', async () => {
      await request(app)
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullName: 'Chef A', email: 'chefa@restaurant.com', password: 'pass123', role: 'chef' });

      const response = await request(app)
        .get('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.employees).toBeDefined();
      expect(Array.isArray(response.body.employees)).toBe(true);
      // Admin + 1 chef created above
      expect(response.body.employees.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by role when role query param is provided', async () => {
      await request(app)
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullName: 'Chef B', email: 'chefb@restaurant.com', password: 'pass123', role: 'chef' });

      const response = await request(app)
        .get('/api/v1/employees?role=chef')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.employees.every((employee) => employee.role === 'chef')).toBe(true);
    });

    it('does not return employees from another tenant', async () => {
      const otherTenant = await createTestTenant({ contactEmail: 'other@restaurant.com' });
      const otherAdmin = await createTestAdmin(otherTenant._id, { email: 'otheradmin@restaurant.com' });
      const otherTenantToken = buildAdminToken(otherAdmin, otherTenant._id);

      await request(app)
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${otherTenantToken}`)
        .send({ fullName: 'Other Chef', email: 'otherchef@restaurant.com', password: 'pass123', role: 'chef' });

      const response = await request(app)
        .get('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`);

      const allEmails = response.body.employees.map((emp) => emp.email);
      expect(allEmails).not.toContain('otherchef@restaurant.com');
    });
  });

  // ── GET /api/v1/employees/:id ──────────────────────────────────────────

  describe('GET /api/v1/employees/:id', () => {
    it('returns the employee when found within the tenant', async () => {
      const createResponse = await request(app)
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullName: 'Get Chef', email: 'getchef@restaurant.com', password: 'pass123', role: 'chef' });

      const createdEmployeeId = createResponse.body.employee._id;

      const response = await request(app)
        .get(`/api/v1/employees/${createdEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.employee._id).toBe(createdEmployeeId);
    });

    it('returns 404 when employee ID does not exist', async () => {
      const response = await request(app)
        .get('/api/v1/employees/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });
  });

  // ── PUT /api/v1/employees/:id ─────────────────────────────────────────

  describe('PUT /api/v1/employees/:id', () => {
    it('updates employee fullName successfully', async () => {
      const createResponse = await request(app)
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullName: 'Old Name', email: 'update@restaurant.com', password: 'pass123', role: 'chef' });

      const createdEmployeeId = createResponse.body.employee._id;

      const response = await request(app)
        .put(`/api/v1/employees/${createdEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullName: 'New Name' });

      expect(response.status).toBe(200);
      expect(response.body.employee.fullName).toBe('New Name');
    });

    it('returns 400 when role is set to admin', async () => {
      const createResponse = await request(app)
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullName: 'Chef C', email: 'chefc@restaurant.com', password: 'pass123', role: 'chef' });

      const createdEmployeeId = createResponse.body.employee._id;

      const response = await request(app)
        .put(`/api/v1/employees/${createdEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' });

      expect(response.status).toBe(400);
    });
  });

  // ── PATCH /api/v1/employees/:id/deactivate ────────────────────────────

  describe('PATCH /api/v1/employees/:id/deactivate', () => {
    it('deactivates an employee successfully', async () => {
      const createResponse = await request(app)
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullName: 'To Deactivate', email: 'deactivate@restaurant.com', password: 'pass123', role: 'chef' });

      const createdEmployeeId = createResponse.body.employee._id;

      const response = await request(app)
        .patch(`/api/v1/employees/${createdEmployeeId}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Employee deactivated');
    });

    it('returns 400 when admin tries to deactivate their own account', async () => {
      const response = await request(app)
        .patch(`/api/v1/employees/${testAdmin._id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/own account/i);
    });

    it('returns 404 when employee does not exist', async () => {
      const response = await request(app)
        .patch('/api/v1/employees/507f1f77bcf86cd799439011/deactivate')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });
  });
});
