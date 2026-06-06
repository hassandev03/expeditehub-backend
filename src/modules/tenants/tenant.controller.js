const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: generateUniqueTokenIdentifier } = require('uuid');
const { validationResult } = require('express-validator');
const Tenant = require('./tenant.model');
const Employee = require('../employees/employee.model');

async function registerTenant(httpRequest, httpResponse, nextMiddleware) {
  const validationErrors = validationResult(httpRequest);
  if (!validationErrors.isEmpty()) {
    return httpResponse.status(400).json({ errors: validationErrors.array() });
  }

  try {
    const {
      name,
      address,
      cuisineType,
      logoUrl,
      contactEmail,
      contactPhone,
      adminFullName,
      adminEmail,
      adminPassword
    } = httpRequest.body;

    const existingTenantWithContactEmail = await Tenant.findOne({ contactEmail });
    if (existingTenantWithContactEmail) {
      return httpResponse.status(409).json({
        message: 'A tenant with this contact email already exists'
      });
    }

    // Global uniqueness check for admin email across all tenants (per spec step 3)
    const existingEmployeeWithAdminEmail = await Employee.findOne({ email: adminEmail });
    if (existingEmployeeWithAdminEmail) {
      return httpResponse.status(409).json({
        message: 'An employee account with this email already exists'
      });
    }

    const savedTenant = await new Tenant({
      name,
      address,
      cuisineType,
      logoUrl,
      contactEmail,
      contactPhone
    }).save();

    const hashedAdminPassword = await bcrypt.hash(adminPassword, 10);

    const savedAdminEmployee = await new Employee({
      tenantId: savedTenant._id,
      fullName: adminFullName,
      email: adminEmail,
      password: hashedAdminPassword,
      role: 'admin',
      isActive: true
    }).save();

    const accessToken = jwt.sign(
      {
        sub: savedAdminEmployee._id,
        tenantId: savedTenant._id,
        role: 'admin',
        jti: generateUniqueTokenIdentifier()
      },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }
    );

    const refreshToken = jwt.sign(
      {
        sub: savedAdminEmployee._id,
        tenantId: savedTenant._id,
        jti: generateUniqueTokenIdentifier()
      },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRY }
    );

    return httpResponse.status(201).json({
      tenant: savedTenant,
      accessToken,
      refreshToken
    });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

module.exports = { registerTenant };
