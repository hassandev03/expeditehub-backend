const { Router } = require('express');
const { body } = require('express-validator');
const authenticate = require('../../middleware/authenticate');
const tenantScope = require('../../middleware/tenantScope');
const authorise = require('../../middleware/authorise');
const {
  createMenuItem,
  listMenuItems,
  getMenuItem,
  updateMenuItem,
  toggleAvailability,
  deleteMenuItem
} = require('./menuItem.controller');

const menuItemRouter = Router();

menuItemRouter.use(authenticate, tenantScope);

const createMenuItemValidationRules = [
  body('name').notEmpty().withMessage('Menu item name is required'),
  body('price').isFloat({ gt: 0 }).withMessage('Price must be a positive number'),
  body('category').notEmpty().withMessage('Category is required')
];

const updateMenuItemValidationRules = [
  body('price').optional().isFloat({ gt: 0 }).withMessage('Price must be a positive number')
];

const toggleAvailabilityValidationRules = [
  body('isAvailable').isBoolean().withMessage('isAvailable must be a boolean value')
];

menuItemRouter.post('/', authorise('admin'), createMenuItemValidationRules, createMenuItem);
menuItemRouter.get('/', authorise('admin', 'cashier', 'chef'), listMenuItems);
menuItemRouter.get('/:id', authorise('admin'), getMenuItem);
menuItemRouter.put('/:id', authorise('admin'), updateMenuItemValidationRules, updateMenuItem);
menuItemRouter.patch('/:id/availability', authorise('admin', 'chef'), toggleAvailabilityValidationRules, toggleAvailability);
menuItemRouter.delete('/:id', authorise('admin'), deleteMenuItem);

module.exports = menuItemRouter;
