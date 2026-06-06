const jwt = require('jsonwebtoken');
const { redisClient } = require('../../config/redis');

/**
 * Verifies Bearer JWT, checks Redis blacklist, and attaches user data to the request.
 * All protected routes must run this middleware before their route handler.
 */
async function authenticate(httpRequest, httpResponse, nextMiddleware) {
  const authorizationHeader = httpRequest.headers['authorization'];
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return httpResponse.status(401).json({ message: 'Authorization token required' });
  }

  const bearerToken = authorizationHeader.split(' ')[1];

  let decodedTokenPayload;
  try {
    decodedTokenPayload = jwt.verify(bearerToken, process.env.ACCESS_TOKEN_SECRET);
  } catch (tokenVerificationError) {
    return httpResponse.status(401).json({ message: 'Invalid or expired token' });
  }

  const blacklistedTokenEntry = await redisClient.get(`blacklist:${decodedTokenPayload.jti}`);
  if (blacklistedTokenEntry) {
    return httpResponse.status(401).json({ message: 'Token has been revoked' });
  }

  httpRequest.user = {
    _id: decodedTokenPayload.sub,
    tenantId: decodedTokenPayload.tenantId,
    role: decodedTokenPayload.role,
    jti: decodedTokenPayload.jti,
    exp: decodedTokenPayload.exp
  };

  nextMiddleware();
}

module.exports = authenticate;
