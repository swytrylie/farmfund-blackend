const multer = require('multer');
const ApiError = require('../utils/ApiError');

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB: safely under Vercel's request-size limit

// Keeps the file in memory (Vercel has no disk) and refuses anything bigger
// than 2 MB while it is still being received.
const receive = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 10, fieldSize: 2000, parts: 12 },
}).single('file');

function uploadCertificateFile(req, res, next) {
  receive(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(ApiError.badRequest('That file is larger than 2 MB. Choose a smaller one.'));
    return next(ApiError.badRequest('The upload could not be read. Please try again.'));
  });
}

module.exports = { uploadCertificateFile, MAX_BYTES };