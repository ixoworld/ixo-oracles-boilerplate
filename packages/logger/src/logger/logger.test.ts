// import * as winston from 'winston';
// import { Logger } from './logger';

// // Mock winston module
// jest.mock('winston', () => ({
//   createLogger: jest.fn().mockReturnValue({
//     info: jest.fn(),
//     warn: jest.fn(),
//     error: jest.fn(),
//   }),
//   format: {
//     combine: jest.fn(),
//     timestamp: jest.fn(),
//     printf: jest.fn(),
//   },
//   transports: {
//     Console: jest.fn(),
//   },
// }));

// describe('Logger', () => {
//   let logger: Logger;
//   let mockWinstonLogger: jest.Mocked<winston.Logger>;

//   beforeEach(() => {
//     jest.clearAllMocks();
//     mockWinstonLogger = winston.createLogger() as jest.Mocked<winston.Logger>;
//     logger = Logger.getInstance();
//   });

//   afterAll(() => {
//     jest.resetModules();
//   });

//   describe('Instance Methods', () => {
//     describe('info()', () => {
//       it('should log info messages with metadata', () => {
//         const message = 'Info message';
//         const metadata = { key: 'value' };

//         logger.info(message, metadata);

//         expect(mockWinstonLogger.info).toHaveBeenCalledTimes(1);
//         expect(mockWinstonLogger.info).toHaveBeenCalledWith(message, [
//           metadata,
//         ]);
//       });

//       it('should log info messages without metadata', () => {
//         const message = 'Info message';

//         logger.info(message);

//         expect(mockWinstonLogger.info).toHaveBeenCalledTimes(1);
//         expect(mockWinstonLogger.info).toHaveBeenCalledWith(message, []);
//       });
//     });

//     describe('warn()', () => {
//       it('should log warn messages with metadata', () => {
//         const message = 'Warn message';
//         const metadata = { key: 'value' };

//         logger.warn(message, metadata);

//         expect(mockWinstonLogger.warn).toHaveBeenCalledTimes(1);
//         expect(mockWinstonLogger.warn).toHaveBeenCalledWith(message, [
//           metadata,
//         ]);
//       });

//       it('should log warn messages without metadata', () => {
//         const message = 'Warn message';

//         logger.warn(message);

//         expect(mockWinstonLogger.warn).toHaveBeenCalledTimes(1);
//         expect(mockWinstonLogger.warn).toHaveBeenCalledWith(message, []);
//       });
//     });

//     describe('error()', () => {
//       it('should log error messages with Error object', () => {
//         const message = 'Error message';
//         const error = new Error('Test error');

//         logger.error(message, error);

//         expect(mockWinstonLogger.error).toHaveBeenCalledTimes(1);
//         expect(mockWinstonLogger.error).toHaveBeenCalledWith(message, [
//           logger.formatError(error),
//         ]);
//       });

//       it('should log error messages with metadata', () => {
//         const message = 'Error message';
//         const metadata = { key: 'value' };

//         logger.error(message, metadata);

//         expect(mockWinstonLogger.error).toHaveBeenCalledTimes(1);
//         expect(mockWinstonLogger.error).toHaveBeenCalledWith(message, [
//           metadata,
//         ]);
//       });

//       it('should log error messages without metadata', () => {
//         const message = 'Error message';

//         logger.error(message);

//         expect(mockWinstonLogger.error).toHaveBeenCalledTimes(1);
//         expect(mockWinstonLogger.error).toHaveBeenCalledWith(message, []);
//       });
//     });

//     describe('formatError()', () => {
//       it('should format error with stack trace', () => {
//         const error = new Error('Test error');
//         const formattedError = logger.formatError(error);

//         expect(formattedError).toContain('Error: Test error');
//         expect(formattedError).toContain(error.stack);
//       });

//       it('should handle errors without stack trace', () => {
//         const error = new Error('Test error');
//         delete error.stack;

//         const formattedError = logger.formatError(error);

//         expect(formattedError).toContain('Error: Test error');
//         expect(formattedError).not.toContain('undefined');
//       });
//     });
//   });

//   describe('Static Methods', () => {
//     describe('info()', () => {
//       it('should log info messages with metadata', () => {
//         const message = 'Static info message';
//         const metadata = { key: 'value' };

//         Logger.info(message, metadata);

//         expect(mockWinstonLogger.info).toHaveBeenCalledTimes(1);
//         expect(mockWinstonLogger.info).toHaveBeenCalledWith(message, [
//           [metadata],
//         ]);
//       });
//     });

//     describe('warn()', () => {
//       it('should log warn messages with metadata', () => {
//         const message = 'Static warn message';
//         const metadata = { key: 'value' };

//         Logger.warn(message, metadata);

//         expect(mockWinstonLogger.warn).toHaveBeenCalledTimes(1);
//         expect(mockWinstonLogger.warn).toHaveBeenCalledWith(message, [
//           metadata,
//         ]);
//       });
//     });

//     describe('error()', () => {
//       it('should log error messages with Error object', () => {
//         const message = 'Static error message';
//         const error = new Error('Test error');

//         Logger.error(message, error);

//         expect(mockWinstonLogger.error).toHaveBeenCalledTimes(1);
//         expect(mockWinstonLogger.error).toHaveBeenCalledWith(message, []);
//       });
//     });
//   });

//   describe('Singleton Pattern', () => {
//     it('should return the same instance', () => {
//       const instance1 = Logger.getInstance();
//       const instance2 = Logger.getInstance();

//       expect(instance1).toBe(instance2);
//     });

//     it('should maintain state between getInstance calls', () => {
//       const instance1 = Logger.getInstance();
//       const instance2 = Logger.getInstance();

//       const message = 'Test message';
//       instance1.info(message);

//       expect(mockWinstonLogger.info).toHaveBeenCalledTimes(1);
//       expect(mockWinstonLogger.info).toHaveBeenCalledWith(message, []);

//       instance2.info(message);
//       expect(mockWinstonLogger.info).toHaveBeenCalledTimes(2);
//     });
//   });
// });
