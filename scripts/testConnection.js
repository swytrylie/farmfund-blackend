require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { Crop } = require('../models');

/**
 * Run with: node scripts/testConnection.js
 * This connects to Atlas, inserts one test Crop document (creating the
 * database + collection if they don't exist yet), reads it back, then
 * cleans up and disconnects.
 */
async function run() {
  await connectDB();

  console.log('\n[test] Inserting a test Crop document...');
  const crop = await Crop.create({
    name: `Test Crop ${Date.now()}`,
    variety: 'Sample',
    category: 'grain',
    typicalGrowingDays: 90,
  });
  console.log('[test] Inserted:', crop);

  console.log('\n[test] Reading it back from the database...');
  const found = await Crop.findById(crop._id);
  console.log('[test] Found:', found);

  console.log('\n[test] Cleaning up (deleting the test document)...');
  await Crop.deleteOne({ _id: crop._id });
  console.log('[test] Done. Check Atlas > Browse Collections — you should');
  console.log('       now see your database with a "crops" collection');
  console.log('       (it may be empty since we cleaned up, but it exists).');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('[test] Failed:', err.message);
  process.exit(1);
});
