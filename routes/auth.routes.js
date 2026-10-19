const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { loginLimiter, registerLimiter, refreshLimiter, lockStatusLimiter } = require('../middleware/authLimiter');
const { protect } = require('../middleware/auth');
const {
  registerRules,
  loginRules,
  lockStatusRules,
  lockContactRules,
  updateProfileRules,
  changePasswordRules,
  verifySignupRules,
  resendSignupOtpRules,
  verifyPasswordChangeRules,
  requestEmailChangeRules,
  verifyEmailChangeRules,
  forgotPasswordRules,
  verifyForgotPasswordRules,
  resetPasswordRules,
  undoEmailChangeRules,
} = require('../validators/auth.validator');
const {
  register,
  login,
  refresh,
  recordActivity,
  lockStatus,
  contactAdminAboutLock,
  logout,
  getMe,
  updateProfile,
  requestPasswordChange,
  verifyPasswordChange,
  requestEmailChange,
  verifyEmailChange,
  undoEmailChange,
  forgotPassword,
  verifyForgotPassword,
  resetPassword,
  verifySignupOtp,
  resendSignupOtp,
} = require('../controllers/auth.controller');

const router = express.Router();

router.post('/register', registerLimiter, registerRules, handleValidationErrors, asyncHandler(register));
router.post('/login', loginLimiter, loginRules, handleValidationErrors, asyncHandler(login));
router.post('/refresh', refreshLimiter, asyncHandler(refresh));
router.post('/logout', asyncHandler(logout));
// Sent by the browser when the person does something; the only thing that
// extends the 10-minute idle timer.
router.post('/activity', protect, asyncHandler(recordActivity));

// Locked-out screen: "am I unlocked yet?" and "contact the admin". Public, since
// the person can't log in. The message counts every attempt per IP, like sign-up.
router.post('/lock-status', lockStatusLimiter, lockStatusRules, handleValidationErrors, asyncHandler(lockStatus));
router.post('/lock-contact', registerLimiter, lockContactRules, handleValidationErrors, asyncHandler(contactAdminAboutLock));
router.get('/me', protect, asyncHandler(getMe));
router.patch('/me', protect, updateProfileRules, handleValidationErrors, asyncHandler(updateProfile));

// Signup email verification — public, since the account exists but can't
// log in yet, so there's no session to protect these with.
router.post('/verify-signup', verifySignupRules, handleValidationErrors, asyncHandler(verifySignupOtp));
router.post('/resend-signup-otp', resendSignupOtpRules, handleValidationErrors, asyncHandler(resendSignupOtp));

// Password change — now a two-step flow. Both steps require a real
// session (protect), unlike signup verification, since this is always
// someone already logged in changing their own password.
router.post('/change-password/request', protect, changePasswordRules, handleValidationErrors, asyncHandler(requestPasswordChange));
router.post('/change-password/verify', protect, verifyPasswordChangeRules, handleValidationErrors, asyncHandler(verifyPasswordChange));

// Email change — also two steps. The code goes to the NEW address, and the
// account's email only changes once that code is confirmed.
router.post('/change-email/request', protect, requestEmailChangeRules, handleValidationErrors, asyncHandler(requestEmailChange));
router.post('/change-email/verify', protect, verifyEmailChangeRules, handleValidationErrors, asyncHandler(verifyEmailChange));

// Forgot password — public (the person can't log in). The request step counts
// every attempt per IP, like sign-up does, so it can't be used to flood
// strangers' inboxes; the code and reset steps count only failures, like login.
router.post('/forgot-password', registerLimiter, forgotPasswordRules, handleValidationErrors, asyncHandler(forgotPassword));
router.post('/forgot-password/verify', loginLimiter, verifyForgotPasswordRules, handleValidationErrors, asyncHandler(verifyForgotPassword));
router.post('/reset-password', loginLimiter, resetPasswordRules, handleValidationErrors, asyncHandler(resetPassword));

// "No, secure my account" link from the email-changed notice — public, since
// whoever opens it may be locked out of the account.
router.post('/email-change/undo', loginLimiter, undoEmailChangeRules, handleValidationErrors, asyncHandler(undoEmailChange));

module.exports = router;