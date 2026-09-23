const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { loginLimiter, registerLimiter, refreshLimiter } = require('../middleware/authLimiter');
const { protect } = require('../middleware/auth');
const { registerRules, loginRules } = require('../validators/auth.validator');
const { register, login, refresh, logout, getMe } = require('../controllers/auth.controller');

const router = express.Router();

router.post('/register', registerLimiter, registerRules, handleValidationErrors, asyncHandler(register));
router.post('/login', loginLimiter, loginRules, handleValidationErrors, asyncHandler(login));
router.post('/refresh', refreshLimiter, asyncHandler(refresh));
router.post('/logout', asyncHandler(logout));
router.get('/me', protect, asyncHandler(getMe));

module.exports = router;