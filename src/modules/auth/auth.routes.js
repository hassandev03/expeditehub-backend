const { Router } = require('express');
const { body } = require('express-validator');
const authenticate = require('../../middleware/authenticate');
const tenantScope = require('../../middleware/tenantScope');
const { login, refresh, logout } = require('./auth.controller');

const authRouter = Router();

const loginValidationRules = [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
];

const refreshValidationRules = [
  body('refreshToken').notEmpty().withMessage('Refresh token is required')
];

authRouter.post('/login', loginValidationRules, login);
authRouter.post('/refresh', refreshValidationRules, refresh);
authRouter.post('/logout', authenticate, tenantScope, logout);

module.exports = authRouter;
