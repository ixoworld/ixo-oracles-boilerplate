// import dotenv from 'dotenv';
// import express from 'express';
// import request from 'supertest';
// import routes from '../src/routes/index.js';

// // Load environment variables
// dotenv.config();

// describe('AppController (e2e)', () => {
//   let app: express.Express;

//   beforeAll(async () => {
//     app = express();

//     // Middleware
//     app.use(express.json());

//     // Register routes
//     app.use('/', routes);
//   });

//   it('/ (GET)', () => {
//     return request(app)
//       .get('/')
//       .expect(200)
//       .expect((res) => {
//         expect(res.body).toHaveProperty('config');
//       });
//   });
// });
