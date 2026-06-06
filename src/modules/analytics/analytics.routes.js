const { Router } = require('express');
const authenticate = require('../../middleware/authenticate');
const tenantScope = require('../../middleware/tenantScope');
const authorise = require('../../middleware/authorise');
const {
  getSummary,
  getByCategory,
  getByCashier,
  getByChef,
  getActiveOrdersCount
} = require('./analytics.controller');

const analyticsRouter = Router();

analyticsRouter.use(authenticate, tenantScope, authorise('admin'));

analyticsRouter.get('/summary', getSummary);
analyticsRouter.get('/by-category', getByCategory);
analyticsRouter.get('/by-cashier', getByCashier);
analyticsRouter.get('/by-chef', getByChef);
analyticsRouter.get('/active-orders-count', getActiveOrdersCount);

module.exports = analyticsRouter;
