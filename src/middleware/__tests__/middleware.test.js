// Mock Redis before any module loads that imports it
jest.mock('../../../config/redis', () => ({
  redisClient: {
    get: jest.fn().mockResolvedValue(null)
  }
}));

const jwt = require('jsonwebtoken');
const authenticate = require('../authenticate');
const authorise = require('../authorise');
const tenantScope = require('../tenantScope');
const { redisClient } = require('../../../config/redis');

process.env.ACCESS_TOKEN_SECRET = 'test-access-secret-for-middleware-tests';

// ─── Helper to build mock Express objects ──────────────────────────────────

function buildMockHttpResponse() {
  const mockHttpResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
  return mockHttpResponse;
}

// ─── authenticate ──────────────────────────────────────────────────────────

describe('authenticate middleware', () => {
  let mockNextMiddleware;

  beforeEach(() => {
    mockNextMiddleware = jest.fn();
    jest.clearAllMocks();
    redisClient.get.mockResolvedValue(null);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const mockHttpRequest = { headers: {} };
    const mockHttpResponse = buildMockHttpResponse();

    await authenticate(mockHttpRequest, mockHttpResponse, mockNextMiddleware);

    expect(mockHttpResponse.status).toHaveBeenCalledWith(401);
    expect(mockNextMiddleware).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is not Bearer format', async () => {
    const mockHttpRequest = { headers: { authorization: 'Basic sometoken' } };
    const mockHttpResponse = buildMockHttpResponse();

    await authenticate(mockHttpRequest, mockHttpResponse, mockNextMiddleware);

    expect(mockHttpResponse.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when token is invalid or expired', async () => {
    const mockHttpRequest = { headers: { authorization: 'Bearer this-is-not-a-valid-jwt' } };
    const mockHttpResponse = buildMockHttpResponse();

    await authenticate(mockHttpRequest, mockHttpResponse, mockNextMiddleware);

    expect(mockHttpResponse.status).toHaveBeenCalledWith(401);
    expect(mockNextMiddleware).not.toHaveBeenCalled();
  });

  it('returns 401 when token jti is blacklisted in Redis', async () => {
    const tokenPayload = {
      sub: 'employee-id-123',
      tenantId: 'tenant-id-123',
      role: 'admin',
      jti: 'blacklisted-jti-abc'
    };
    const validToken = jwt.sign(tokenPayload, 'test-access-secret-for-middleware-tests', {
      expiresIn: '15m'
    });

    redisClient.get.mockResolvedValueOnce('1'); // simulates blacklist hit

    const mockHttpRequest = { headers: { authorization: `Bearer ${validToken}` } };
    const mockHttpResponse = buildMockHttpResponse();

    await authenticate(mockHttpRequest, mockHttpResponse, mockNextMiddleware);

    expect(mockHttpResponse.status).toHaveBeenCalledWith(401);
    expect(mockHttpResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Token has been revoked' })
    );
    expect(mockNextMiddleware).not.toHaveBeenCalled();
  });

  it('attaches user to request and calls next for a valid, non-blacklisted token', async () => {
    const tokenPayload = {
      sub: 'employee-id-456',
      tenantId: 'tenant-id-456',
      role: 'cashier',
      jti: 'valid-jti-xyz'
    };
    const validToken = jwt.sign(tokenPayload, 'test-access-secret-for-middleware-tests', {
      expiresIn: '15m'
    });

    const mockHttpRequest = { headers: { authorization: `Bearer ${validToken}` } };
    const mockHttpResponse = buildMockHttpResponse();

    await authenticate(mockHttpRequest, mockHttpResponse, mockNextMiddleware);

    expect(mockNextMiddleware).toHaveBeenCalledWith();
    expect(mockHttpRequest.user).toBeDefined();
    expect(mockHttpRequest.user._id).toBe('employee-id-456');
    expect(mockHttpRequest.user.tenantId).toBe('tenant-id-456');
    expect(mockHttpRequest.user.role).toBe('cashier');
    expect(mockHttpRequest.user.jti).toBe('valid-jti-xyz');
  });
});

// ─── authorise ─────────────────────────────────────────────────────────────

describe('authorise middleware', () => {
  it('calls next when user role matches the single allowed role', () => {
    const mockHttpRequest = { user: { role: 'admin' } };
    const mockHttpResponse = buildMockHttpResponse();
    const mockNextMiddleware = jest.fn();

    authorise('admin')(mockHttpRequest, mockHttpResponse, mockNextMiddleware);

    expect(mockNextMiddleware).toHaveBeenCalledWith();
  });

  it('calls next when user role is in a list of multiple allowed roles', () => {
    const mockHttpRequest = { user: { role: 'chef' } };
    const mockHttpResponse = buildMockHttpResponse();
    const mockNextMiddleware = jest.fn();

    authorise('admin', 'chef')(mockHttpRequest, mockHttpResponse, mockNextMiddleware);

    expect(mockNextMiddleware).toHaveBeenCalledWith();
  });

  it('returns 403 when user role is not in the allowed roles list', () => {
    const mockHttpRequest = { user: { role: 'cashier' } };
    const mockHttpResponse = buildMockHttpResponse();
    const mockNextMiddleware = jest.fn();

    authorise('admin')(mockHttpRequest, mockHttpResponse, mockNextMiddleware);

    expect(mockHttpResponse.status).toHaveBeenCalledWith(403);
    expect(mockNextMiddleware).not.toHaveBeenCalled();
  });
});

// ─── tenantScope ───────────────────────────────────────────────────────────

describe('tenantScope middleware', () => {
  it('copies tenantId from user to request', () => {
    const mockHttpRequest = { user: { tenantId: 'tenant-abc' } };
    const mockHttpResponse = buildMockHttpResponse();
    const mockNextMiddleware = jest.fn();

    tenantScope(mockHttpRequest, mockHttpResponse, mockNextMiddleware);

    expect(mockHttpRequest.tenantId).toBe('tenant-abc');
    expect(mockNextMiddleware).toHaveBeenCalledWith();
  });
});
