import { Logger } from '@ixo/logger';
import compression from 'compression';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import routes from './routes';

// Load environment variables
dotenv.config();

// Create a logger instance with a context for server
const serverLogger = Logger.getInstance().setContext('Server');

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet()); // Set security headers

// CORS configuration
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*', // Configure as needed
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
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
  serverLogger.info(`${req.method} ${req.url}`, {
    method: req.method,
    url: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Track response time
  const startTime = Date.now();

  // Log response on finish event
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    serverLogger.info(`Response: ${res.statusCode}`, {
      method: req.method,
      url: req.path,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
    });
  });

  next();
});

// Health check endpoint
app.get('/health', (_, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Register routes
app.use('/', routes);

// 404 handler
app.use((req, res) => {
  serverLogger.warn(`Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Not Found' });
});

// Error handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    serverLogger.error(`Error processing request: ${err.message}`, err);
    res.status(500).json({ error: 'Internal server error' });
  },
);

// Start the server
app.listen(port, () => {
  serverLogger.info(`Server is running on port ${port}`);
});
