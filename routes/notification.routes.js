const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const { listMine, markRead, markAllRead } = require('../controllers/notification.controller');
const { listMineRules, notificationIdRule, markAllRules } = require('../validators/notification.validator');

const router = express.Router();

// Any signed-in person: each only ever sees their own notifications.
router.use(protect);

router.get('/', listMineRules, handleValidationErrors, asyncHandler(listMine));
router.post('/read-all', markAllRules, handleValidationErrors, asyncHandler(markAllRead)); // before '/:id/read' so "read-all" is never taken for an id
router.post('/:id/read', notificationIdRule, handleValidationErrors, asyncHandler(markRead));

module.exports = router;