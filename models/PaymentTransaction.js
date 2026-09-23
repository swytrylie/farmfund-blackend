const mongoose = require('mongoose');

/**
 * PaymentTransaction
 * ------------------
 * Payment gateway integration is a separate technical concern and is
 * NOT finalized yet (per design notes). This is a minimal placeholder
 * collection so LoanPayment can reference it once the gateway is chosen
 * (Stripe, PayMongo, GCash, etc.) — extend fields as that decision lands.
 */
const paymentTransactionSchema = new mongoose.Schema(
  {
    gatewayProvider: { type: String, trim: true }, // e.g. 'gcash', 'paymongo', 'manual'
    gatewayTransactionId: { type: String, trim: true },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending',
    },
    amount: { type: Number, min: 0 },
    rawResponse: { type: mongoose.Schema.Types.Mixed }, // raw gateway payload, shape TBD
  },
  { timestamps: true }
);

module.exports = mongoose.model('PaymentTransaction', paymentTransactionSchema);
