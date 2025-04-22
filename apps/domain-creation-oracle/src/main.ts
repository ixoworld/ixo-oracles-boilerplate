import { EnvService } from '@ixo/common';
import { Logger } from '@ixo/logger';
import { MatrixManager } from '@ixo/matrix';
import { Entities } from '@ixo/oracles-chain-client';
import compression from 'compression';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import asyncHandler from 'express-async-handler';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import httpErrors from 'http-errors';
import { getAuthHeadersValue } from './common/get-auth-headers-value.js';
import { envSchema } from './env/schema.js';
import { messagesRouter } from './routes/messages.router.js';
import { paymentsRouter } from './routes/payments.js';
import { sessionsRouter } from './routes/sessions.router.js';
import sseService from './services/sse/sse.service.js';
// Load environment variables
dotenv.config();

// Create a logger instance with a context for server
const serverLogger = Logger.getInstance().setContext('Server');

const app = express();
const port = 4200;

// Security middleware
app.use(helmet()); // Set security headers

// CORS configuration
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*', // Configure as needed
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-matrix-access-token',
      'x-did',
      'x-request-id',
    ],
    exposedHeaders: ['X-Request-Id'],
  }),
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  message: 'Too many requests from this IP, please try again later',
});

// Apply rate limiting to all requests
app.use(limiter);

// Compression middleware
app.use(compression()); // Compress responses

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  // Log request
  // serverLogger.info(`${req.method} ${req.url}`, {
  //   method: req.method,
  //   url: req.path,
  //   ip: req.ip,
  //   userAgent: req.get('user-agent'),
  // });

  next();
});

// Health check endpoint
app.get('/health', (_, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Register routes
app.use((req, res, next) => {
  // check for token
  const matrixAccessToken = req.headers['x-matrix-access-token'];
  const did = req.headers['x-did'];
  if (!matrixAccessToken || !did) {
    return next(
      httpErrors.Unauthorized(
        'Unauthorized: missing matrix access token or did in header x-matrix-access-token or x-did',
      ),
    );
  }
  next();
});

// Endpoint: Client connects to listen for updates
app.get(
  '/sse/:sessionId',
  asyncHandler(async (req, res) => {
    await sseService.createAndRegisterSession(req, res);
  }),
);

app.use('/payments', paymentsRouter);
app.use('/sessions', sessionsRouter);
app.use('/messages', messagesRouter);
app.use(
  '/',
  asyncHandler(async (req, res) => {
    const { matrixAccessToken } = getAuthHeadersValue(req);
    const surveyJsDomain = await Entities.getSurveyJsDomain(
      {
        protocolDid: 'did:ixo:entity:123d410c9d91a80dabbafed0b463e4b2',
      },
      matrixAccessToken,
    );
    res.json({ surveyJsDomain: surveyJsDomain });
  }),
);
// Error handling middleware
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    serverLogger.error(`Error processing request: ${err.message}`, err);
    if (err instanceof httpErrors.HttpError) {
      return res
        .status(err.statusCode)
        .json({ error: err.message, code: err.statusCode });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  },
);
// 404 handler
app.use((req, res) => {
  serverLogger.warn(`Route not found: ${req.method} ${req.url}`);
  return res.status(404).json({ error: 'Not Found' });
});

EnvService.initialize(envSchema);
const matrixManager = MatrixManager.getInstance();
await matrixManager.init();
// Start the server
app.listen(port, () => {
  serverLogger.info(`Server is running on port ${port}`);
});

process.on('SIGINT', () => {
  serverLogger.info('SIGINT signal received. Shutting down...');
  process.exit(0);
});
