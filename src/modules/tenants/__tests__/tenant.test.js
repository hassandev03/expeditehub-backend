// jest.mock calls are hoisted to the top by Jest — they run before any require()
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
const app = require('../../../../app');
const {
  startTestDatabase,
  stopTestDatabase,
  clearTestDatabaseCollections
} = require('../../../tests/databaseTestHelper');

// Environment variables for JWT signing (set before modules are loaded in tests)
process.env.ACCESS_TOKEN_SECRET = 'test-access-secret-tenant-tests';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-tenant-tests';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';

const validRegistrationPayload = {
  name: 'The Test Kitchen',
  address: '123 Test Street, Karachi',
  contactEmail: 'kitchen@test.com',
  adminFullName: 'Test Admin User',
  adminEmail: 'admin@testkitchen.com',
  adminPassword: 'securepassword123'
};

describe('Tenant Module — POST /api/v1/tenants/register', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  afterEach(async () => {
    await clearTestDatabaseCollections();
  });

  it('registers a new tenant and returns 201 with tenant + accessToken + refreshToken', async () => {
    const response = await request(app)
      .post('/api/v1/tenants/register')
      .send(validRegistrationPayload);

    expect(response.status).toBe(201);
    expect(response.body.tenant).toBeDefined();
    expect(response.body.tenant.name).toBe('The Test Kitchen');
    expect(response.body.tenant.contactEmail).toBe('kitchen@test.com');
    expect(response.body.accessToken).toBeDefined();
    expect(response.body.refreshToken).toBeDefined();
  });

  it('does not include password in the response', async () => {
    const response = await request(app)
      .post('/api/v1/tenants/register')
      .send(validRegistrationPayload);

    expect(response.status).toBe(201);
    // No password field anywhere in the response
    expect(JSON.stringify(response.body)).not.toContain('password');
  });

  it('returns 400 when required field name is missing', async () => {
    const { name: _omitted, ...payloadWithoutName } = validRegistrationPayload;

    const response = await request(app)
      .post('/api/v1/tenants/register')
      .send(payloadWithoutName);

    expect(response.status).toBe(400);
    expect(response.body.errors).toBeDefined();
  });

  it('returns 400 when contactEmail is invalid format', async () => {
    const response = await request(app)
      .post('/api/v1/tenants/register')
      .send({ ...validRegistrationPayload, contactEmail: 'not-an-email' });

    expect(response.status).toBe(400);
  });

  it('returns 400 when adminPassword is too short', async () => {
    const response = await request(app)
      .post('/api/v1/tenants/register')
      .send({ ...validRegistrationPayload, adminPassword: '123' });

    expect(response.status).toBe(400);
  });

  it('returns 409 when contactEmail is already registered to another tenant', async () => {
    await request(app).post('/api/v1/tenants/register').send(validRegistrationPayload);

    const response = await request(app)
      .post('/api/v1/tenants/register')
      .send({ ...validRegistrationPayload, adminEmail: 'different@admin.com' });

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/tenant/i);
  });

  it('returns 409 when adminEmail is already registered as an employee', async () => {
    await request(app).post('/api/v1/tenants/register').send(validRegistrationPayload);

    const response = await request(app)
      .post('/api/v1/tenants/register')
      .send({
        ...validRegistrationPayload,
        contactEmail: 'different-restaurant@test.com',
        // same adminEmail as previous registration
        adminEmail: validRegistrationPayload.adminEmail
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/employee/i);
  });

  it('supports optional fields cuisineType, logoUrl, contactPhone', async () => {
    const response = await request(app)
      .post('/api/v1/tenants/register')
      .send({
        ...validRegistrationPayload,
        cuisineType: 'Italian',
        logoUrl: 'https://example.com/logo.png',
        contactPhone: '+92-300-1234567'
      });

    expect(response.status).toBe(201);
    expect(response.body.tenant.cuisineType).toBe('Italian');
  });
});
