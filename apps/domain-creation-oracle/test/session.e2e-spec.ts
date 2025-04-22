import { sessionsRouter } from '../src/routes/sessions.router.js';
import dotenv from 'dotenv';
import express from 'express';
import request from 'supertest';

// Load environment variables
dotenv.config();

describe('AppController (e2e)', () => {
  let app: express.Express;

  beforeAll(async () => {
    app = express();

    // Middleware
    app.use(express.json());

    // Register routes
    app.use('/sessions', sessionsRouter);
  });

  it('/sessions (GET)', () => {
    return request(app)
      .get('/sessions')
      .set('Accept', 'application/json')
      .set('Content-Type', 'application/json')
      .set('x-api-key', process.env.API_KEY || 'test-api-key')
      .set('x-did', 'did:x:zQ3shY2jRreDd6WfGA3PJdhzHhfC3Uknb6TvPcKriSSmePNks')
      .set(
        'x-matrix-access-token',
        'syt_ZGlkLWl4by1peG8xeHB3dzYzNzl1Mjl5ZHZoNTR2bW42bmEyZXl4eXA4cms3ZnNycjA_xpdlkWqLSKUZNQXrhGMu_3yUz9t',
      )
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('config');
      });
  });
});
