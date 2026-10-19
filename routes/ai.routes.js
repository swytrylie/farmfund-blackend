const express = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const { chatRules, refreshRules } = require('../validators/ai.validator');
const { getAdvisor, getSummary, getChatHistory, clearChatHistory, chat } = require('../controllers/ai.controller');

const router = express.Router();

// The free Gemini tier allows only a few requests a minute for the whole app,
// so each farmer gets a small allowance for the calls that use it.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  keyGenerator: (req) => String(req.user._id),
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many questions in a minute. Please wait a moment and try again.' },
});

router.get('/advisor', protect, aiLimiter, refreshRules, handleValidationErrors, asyncHandler(getAdvisor));
router.get('/summary', protect, aiLimiter, refreshRules, handleValidationErrors, asyncHandler(getSummary));
router.get('/chat', protect, asyncHandler(getChatHistory));
router.delete('/chat', protect, asyncHandler(clearChatHistory));
router.post('/chat', protect, aiLimiter, chatRules, handleValidationErrors, asyncHandler(chat));

module.exports = router;
