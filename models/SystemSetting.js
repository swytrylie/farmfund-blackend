const mongoose = require('mongoose');

/**
 * SystemSetting
 * -------------
 * One row (key "main") holding the platform-wide settings an admin can change.
 * For now that is maintenance mode:
 *   maintenanceEnabled = the manual on/off switch
 *   windowStart/End    = an optional scheduled window; between the two times
 *                        maintenance is on by itself (checked against the clock
 *                        on each request, so no timer job is needed)
 */
const systemSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'main' },
    maintenanceEnabled: { type: Boolean, default: false },
    windowStart: { type: Date },
    windowEnd: { type: Date },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedByName: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SystemSetting', systemSettingSchema);