const { Router } = require('express');
const { body } = require('express-validator');
const authenticate = require('../../middleware/authenticate');
const tenantScope = require('../../middleware/tenantScope');
const authorise = require('../../middleware/authorise');
const {
  createEmployee,
  listEmployees,
  getEmployee,
  updateEmployee,
  deactivateEmployee
} = require('./employee.controller');

const employeeRouter = Router();

// All employee routes require a valid admin token
employeeRouter.use(authenticate, tenantScope, authorise('admin'));

const createEmployeeValidationRules = [
  body('fullName').notEmpty().withMessage('Full name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role')
    .isIn(['chef', 'cashier'])
    .withMessage('Role must be either chef or cashier — admins cannot be created via this endpoint')
];

const updateEmployeeValidationRules = [
  body('role')
    .optional()
    .isIn(['chef', 'cashier'])
    .withMessage('Role must be either chef or cashier')
];

employeeRouter.post('/', createEmployeeValidationRules, createEmployee);
employeeRouter.get('/', listEmployees);
employeeRouter.get('/:id', getEmployee);
employeeRouter.put('/:id', updateEmployeeValidationRules, updateEmployee);
employeeRouter.patch('/:id/deactivate', deactivateEmployee);

module.exports = employeeRouter;
