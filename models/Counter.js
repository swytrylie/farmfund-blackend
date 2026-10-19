const mongoose = require('mongoose');

/**
 * Counter
 * -------
 * A named number that only goes up (receipt numbers). The increment is done by
 * the database in one step, so two people can never get the same number.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model('Counter', counterSchema);