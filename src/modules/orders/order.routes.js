const { Router } = require('express');
const { body } = require('express-validator');
const authenticate = require('../../middleware/authenticate');
const tenantScope = require('../../middleware/tenantScope');
const authorise = require('../../middleware/authorise');
const {
  createOrder,
  listActiveOrders,
  listOrderHistory,
  updateOrderStatus,
  payOrder
} = require('./order.controller');

const orderRouter = Router();

orderRouter.use(authenticate, tenantScope);

const createOrderValidationRules = [
  body('items').isArray({ min: 1 }).withMessage('Order must contain at least one item'),
  body('items.*.menuItemId').notEmpty().withMessage('Each item must have a valid menu item ID'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Each item quantity must be at least 1')
];

const updateOrderStatusValidationRules = [
  body('status')
    .isIn(['Preparing', 'Ready'])
    .withMessage('Status must be Preparing or Ready')
];

orderRouter.post('/', authorise('cashier'), createOrderValidationRules, createOrder);

// /history must be defined before /:id to prevent Express from treating "history" as an ID param
orderRouter.get('/history', authorise('admin'), listOrderHistory);
orderRouter.get('/', authorise('chef', 'cashier'), listActiveOrders);

orderRouter.patch('/:id/status', authorise('chef'), updateOrderStatusValidationRules, updateOrderStatus);
orderRouter.patch('/:id/pay', authorise('cashier'), payOrder);

module.exports = orderRouter;
