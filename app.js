const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const tenantRoutes = require('./src/modules/tenants/tenant.routes');
const authRoutes = require('./src/modules/auth/auth.routes');
const employeeRoutes = require('./src/modules/employees/employee.routes');
const menuItemRoutes = require('./src/modules/menuItems/menuItem.routes');
const orderRoutes = require('./src/modules/orders/order.routes');
const analyticsRoutes = require('./src/modules/analytics/analytics.routes');

const expressApplication = express();

expressApplication.use(helmet());
expressApplication.use(cors());
expressApplication.use(express.json());

expressApplication.use('/api/v1/tenants', tenantRoutes);
expressApplication.use('/api/v1/auth', authRoutes);
expressApplication.use('/api/v1/employees', employeeRoutes);
expressApplication.use('/api/v1/menu-items', menuItemRoutes);
expressApplication.use('/api/v1/orders', orderRoutes);
expressApplication.use('/api/v1/analytics', analyticsRoutes);

// Global error handler — catches errors passed via nextMiddleware(error) in controllers
// eslint-disable-next-line no-unused-vars
expressApplication.use(function handleUnexpectedError(thrownError, httpRequest, httpResponse, nextMiddleware) {
  console.error('Unhandled error:', thrownError);
  httpResponse.status(500).json({ message: 'Internal server error' });
});

module.exports = expressApplication;
