const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const { listMine, markRead, markAllRead } = require('../controllers/announcement.controller');
const { listMineRules, announcementIdRule } = require('../validators/announcement.validator');

const router = express.Router();

// Any signed-in person: each only ever sees the announcements addressed to them.
router.use(protect);

router.get('/', listMineRules, handleValidationErrors, asyncHandler(listMine));
router.post('/read-all', asyncHandler(markAllRead)); // before '/:id/read' so "read-all" is never taken for an id
router.post('/:id/read', announcementIdRule, handleValidationErrors, asyncHandler(markRead));

module.exports = router;