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
const bcrypt = require('bcrypt');
const app = require('../../../../app');
const Employee = require('../../employees/employee.model');
const Tenant = require('../../tenants/tenant.model');
const {
  startTestDatabase,
  stopTestDatabase,
  clearTestDatabaseCollections
} = require('../../../tests/databaseTestHelper');
const { redisClient } = require('../../../../config/redis');

process.env.ACCESS_TOKEN_SECRET = 'test-access-secret-auth-tests';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-auth-tests';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';

// ─── Helpers ───────────────────────────────────────────────────────────────

async function createTestTenantAndAdmin() {
  const savedTenant = await new Tenant({
    name: 'Auth Test Restaurant',
    address: '1 Auth Street',
    contactEmail: 'auth-test@restaurant.com'
  }).save();

  const hashedPassword = await bcrypt.hash('correctpassword', 10);
  const savedAdmin = await new Employee({
    tenantId: savedTenant._id,
    fullName: 'Auth Admin',
    email: 'authadmin@restaurant.com',
    password: hashedPassword,
    role: 'admin',
    isActive: true
  }).save();

  return { savedTenant, savedAdmin };
}

// ─── POST /api/v1/auth/login ───────────────────────────────────────────────

describe('Auth Module — POST /api/v1/auth/login', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  afterEach(async () => {
    await clearTestDatabaseCollections();
  });

  it('returns 200 with accessToken, refreshToken, and employee on valid credentials', async () => {
    await createTestTenantAndAdmin();

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'authadmin@restaurant.com', password: 'correctpassword' });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeDefined();
    expect(response.body.refreshToken).toBeDefined();
    expect(response.body.employee).toBeDefined();
    expect(response.body.employee.role).toBe('admin');
    expect(response.body.employee.password).toBeUndefined();
  });

  it('returns 400 when email is missing or invalid format', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: 'anything' });

    expect(response.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'someone@example.com' });

    expect(response.status).toBe(400);
  });

  it('returns 401 with generic message when email does not exist', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nonexistent@restaurant.com', password: 'anypassword' });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid credentials');
  });

  it('returns 401 with generic message when password is wrong', async () => {
    await createTestTenantAndAdmin();

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'authadmin@restaurant.com', password: 'wrongpassword' });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid credentials');
  });

  it('returns 401 for inactive employee account', async () => {
    const { savedAdmin } = await createTestTenantAndAdmin();
    savedAdmin.isActive = false;
    await savedAdmin.save();

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'authadmin@restaurant.com', password: 'correctpassword' });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid credentials');
  });
});

// ─── POST /api/v1/auth/refresh ─────────────────────────────────────────────

describe('Auth Module — POST /api/v1/auth/refresh', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  afterEach(async () => {
    await clearTestDatabaseCollections();
  });

  it('returns 200 with a new accessToken when refresh token is valid', async () => {
    await createTestTenantAndAdmin();

    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'authadmin@restaurant.com', password: 'correctpassword' });

    const { refreshToken } = loginResponse.body;

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeDefined();
  });

  it('returns 401 when refresh token is invalid', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'completely-invalid-token' });

    expect(response.status).toBe(401);
  });

  it('returns 401 when refreshToken field is missing', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({});

    expect(response.status).toBe(401);
  });
});

// ─── POST /api/v1/auth/logout ──────────────────────────────────────────────

describe('Auth Module — POST /api/v1/auth/logout', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  afterEach(async () => {
    await clearTestDatabaseCollections();
    jest.clearAllMocks();
  });

  it('returns 200 and blacklists the token jti in Redis', async () => {
    await createTestTenantAndAdmin();

    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'authadmin@restaurant.com', password: 'correctpassword' });

    const { accessToken } = loginResponse.body;

    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Logged out successfully');
    expect(redisClient.set).toHaveBeenCalledWith(
      expect.stringMatching(/^blacklist:/),
      '1',
      'EX',
      expect.any(Number)
    );
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const response = await request(app).post('/api/v1/auth/logout');

    expect(response.status).toBe(401);
  });
});
