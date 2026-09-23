require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const connectDB = require('./config/db');
const apiRoutes = require('./routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

// Importing this registers every schema with Mongoose
const models = require('./models');

const app = express();

// Behind a proxy/load balancer (Render, Heroku, Nginx) in production,
// this is required for express-rate-limit and req.ip to see the real
// client IP instead of the proxy's.
app.set('trust proxy', 1);

// ---- Security middleware (order matters: run before routes) ----

// Sets secure HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
app.use(helmet());

// Restrict which origins can call this API. In production, set
// CORS_ORIGIN to your real frontend URL(s) — never leave it wide open.
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true, // fallback: allow all in dev
    credentials: true,
  })
);

// Rate limiting: blunt brute-force/abuse attempts against the whole API.
// 100 requests per 15 minutes per IP is a reasonable general-purpose default.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
});
app.use('/api', globalLimiter);

// Body parsing with a strict size limit — prevents oversized payload attacks
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Parses cookies on incoming requests (needed to read the httpOnly refresh token)
app.use(cookieParser());

// Strips any request keys starting with '$' or containing '.' — prevents
// NoSQL/Mongo operator injection (e.g. { "email": { "$gt": "" } })
app.use(mongoSanitize());

// Prevents HTTP Parameter Pollution (e.g. ?category=grain&category=fruit
// being interpreted unexpectedly by query parsers)
app.use(hpp());

// Gzip compression for responses
app.use(compression());

// Request logging — 'combined' in production for audit-friendly logs,
// 'dev' in development for concise colored output
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ---- Routes ----

app.get('/health', (req, res) => {
  res.json({ status: 'ok', modelsLoaded: Object.keys(models) });
});

app.use('/api', apiRoutes);

// ---- Error handling (must be last, in this order) ----
app.use(notFound);
app.use(errorHandler);

// ---- Start server (local only) ----
// On Vercel, api/index.js imports `app` and handles requests itself,
// so we only listen() when this file is run directly (node server.js).
if (require.main === module) {
  const PORT = process.env.PORT || 5000;

  connectDB().then(() => {
    const server = app.listen(PORT, () =>
      console.log(`[server] Listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`)
    );

    process.on('unhandledRejection', (err) => {
      console.error('[unhandledRejection]', err);
      server.close(() => process.exit(1));
    });

    process.on('uncaughtException', (err) => {
      console.error('[uncaughtException]', err);
      server.close(() => process.exit(1));
    });

    process.on('SIGTERM', () => {
      console.log('[server] SIGTERM received, shutting down gracefully');
      server.close(() => process.exit(0));
    });
  });
}

module.exports = app;