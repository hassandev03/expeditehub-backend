const { Router } = require('express');
const { body } = require('express-validator');
const { registerTenant } = require('./tenant.controller');

const tenantRouter = Router();

const registerTenantValidationRules = [
  body('name').notEmpty().withMessage('Restaurant name is required'),
  body('address').notEmpty().withMessage('Restaurant address is required'),
  body('contactEmail').isEmail().withMessage('Valid contact email is required'),
  body('adminFullName').notEmpty().withMessage('Admin full name is required'),
  body('adminEmail').isEmail().withMessage('Valid admin email is required'),
  body('adminPassword')
    .isLength({ min: 6 })
    .withMessage('Admin password must be at least 6 characters')
];

tenantRouter.post('/register', registerTenantValidationRules, registerTenant);

module.exports = tenantRouter;
