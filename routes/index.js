const express = require('express');
const authRoutes = require('./auth.routes');
const cropRoutes = require('./crop.routes');
const farmRoutes = require('./farm.routes');
const fieldRoutes = require('./field.routes');
const farmingCycleRoutes = require('./farmingCycle.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/crops', cropRoutes);
router.use('/farms', farmRoutes);
router.use('/fields', fieldRoutes);
router.use('/farming-cycles', farmingCycleRoutes);

module.exports = router;