/**
 * Terms & Conditions / data-privacy consent
 * -----------------------------------------
 * The sign-up form shows the Terms and Conditions and will not submit until
 * the person ticks the consent box. The tick is also enforced HERE (see
 * registerRules), so a request that skips the form cannot create an account.
 *
 * What is stored on the User: WHEN they agreed, and WHICH version of the text
 * they agreed to. The version comes from the page that showed the text (so a
 * person who loaded an older page is recorded against the older text); when
 * none is sent, the current version below is used.
 *
 * Bump TERMS_VERSION here — and TERMS_VERSION in the frontend's lib/terms.js
 * — whenever the wording changes in a way people should agree to again.
 */
const TERMS_VERSION = '2026-10';

function consentFields(body) {
  const sent = typeof body.termsVersion === 'string' ? body.termsVersion.trim() : '';
  return {
    termsAcceptedAt: new Date(),
    termsVersion: sent || TERMS_VERSION,
  };
}

module.exports = { TERMS_VERSION, consentFields };