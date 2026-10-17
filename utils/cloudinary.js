// The only place that talks to Cloudinary, so the rest of the app never
// touches it directly. Files are stored as PRIVATE: they have no public
// address, and the only way to open one is a link we sign that stops working
// after a few minutes.
const FOLDER = 'farmfund/certificates';
const PROOF_FOLDER = 'farmfund/payment-proofs';
const COLLATERAL_FOLDER = 'farmfund/collateral';
const CLAIM_FOLDER = 'farmfund/disaster-claims';
const LINK_SECONDS = 300;

function isConfigured(env = process.env) {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

function client() {
  const { v2 } = require('cloudinary');
  v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  return v2;
}

// Sends the file's bytes to Cloudinary. Resolves { publicId, format, bytes }.
function uploadBuffer(buffer, folder = FOLDER) {
  const cloud = client();
  return new Promise((resolve, reject) => {
    const stream = cloud.uploader.upload_stream(
      { resource_type: 'image', type: 'private', folder, unique_filename: true, overwrite: false },
      (err, result) => {
        if (err) return reject(err);
        if (!result || !result.public_id) return reject(new Error('Cloudinary returned no file reference'));
        resolve({ publicId: result.public_id, format: result.format, bytes: result.bytes });
      }
    );
    stream.end(buffer);
  });
}

// A link that opens the file for the next few minutes.
function signedLink(publicId, format) {
  const cloud = client();
  return cloud.utils.private_download_url(publicId, format, {
    resource_type: 'image',
    type: 'private',
    expires_at: Math.floor(Date.now() / 1000) + LINK_SECONDS,
  });
}

// Best effort: a leftover file is harmless, a failed delete must not break anything.
async function destroy(publicId) {
  try {
    await client().uploader.destroy(publicId, { resource_type: 'image', type: 'private', invalidate: true });
    return true;
  } catch (err) {
    console.error('Could not delete a file from Cloudinary:', err && err.message);
    return false;
  }
}

module.exports = { isConfigured, uploadBuffer, signedLink, destroy, LINK_SECONDS, FOLDER, PROOF_FOLDER, COLLATERAL_FOLDER, CLAIM_FOLDER };