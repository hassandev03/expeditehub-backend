const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: generateUniqueTokenIdentifier } = require('uuid');
const { validationResult } = require('express-validator');
const Employee = require('../employees/employee.model');
const { redisClient } = require('../../../config/redis');

async function login(httpRequest, httpResponse, nextMiddleware) {
  const validationErrors = validationResult(httpRequest);
  if (!validationErrors.isEmpty()) {
    return httpResponse.status(400).json({ errors: validationErrors.array() });
  }

  try {
    const { email, password } = httpRequest.body;

    // +password required because the field has select:false on the schema
    const foundEmployee = await Employee.findOne({ email }).select('+password');

    // Deliberately generic message to prevent email enumeration
    if (!foundEmployee || !foundEmployee.isActive) {
      return httpResponse.status(401).json({ message: 'Invalid credentials' });
    }

    const isPasswordCorrect = await bcrypt.compare(password, foundEmployee.password);
    if (!isPasswordCorrect) {
      return httpResponse.status(401).json({ message: 'Invalid credentials' });
    }

    const accessToken = jwt.sign(
      {
        sub: foundEmployee._id,
        tenantId: foundEmployee.tenantId,
        role: foundEmployee.role,
        jti: generateUniqueTokenIdentifier()
      },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }
    );

    const refreshToken = jwt.sign(
      {
        sub: foundEmployee._id,
        tenantId: foundEmployee.tenantId,
        jti: generateUniqueTokenIdentifier()
      },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRY }
    );

    return httpResponse.status(200).json({
      accessToken,
      refreshToken,
      employee: {
        _id: foundEmployee._id,
        fullName: foundEmployee.fullName,
        role: foundEmployee.role,
        tenantId: foundEmployee.tenantId
      }
    });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function refresh(httpRequest, httpResponse, nextMiddleware) {
  try {
    const { refreshToken } = httpRequest.body;
    if (!refreshToken) {
      return httpResponse.status(401).json({ message: 'Refresh token required' });
    }

    let decodedRefreshPayload;
    try {
      decodedRefreshPayload = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    } catch (tokenVerificationError) {
      return httpResponse.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    const foundEmployee = await Employee.findById(decodedRefreshPayload.sub);
    if (!foundEmployee || !foundEmployee.isActive) {
      return httpResponse.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    const newAccessToken = jwt.sign(
      {
        sub: foundEmployee._id,
        tenantId: foundEmployee.tenantId,
        role: foundEmployee.role,
        jti: generateUniqueTokenIdentifier()
      },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }
    );

    return httpResponse.status(200).json({ accessToken: newAccessToken });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function logout(httpRequest, httpResponse, nextMiddleware) {
  try {
    const remainingTokenLifetimeSeconds = httpRequest.user.exp - Math.floor(Date.now() / 1000);

    // Token already expired — nothing to blacklist
    if (remainingTokenLifetimeSeconds <= 0) {
      return httpResponse.status(200).json({ message: 'Logged out successfully' });
    }

    await redisClient.set(
      `blacklist:${httpRequest.user.jti}`,
      '1',
      'EX',
      remainingTokenLifetimeSeconds
    );

    return httpResponse.status(200).json({ message: 'Logged out successfully' });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

module.exports = { login, refresh, logout };
