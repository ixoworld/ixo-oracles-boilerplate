import { Logger } from './logger.js';

// Reset singleton between tests
let origInstance: Logger | undefined;

beforeEach(() => {
  // Access private static to reset singleton for isolation
  origInstance = (Logger as unknown as { instance: Logger | undefined })
    .instance;
  (Logger as unknown as { instance: Logger | undefined }).instance = undefined;
});

afterEach(() => {
  (Logger as unknown as { instance: Logger | undefined }).instance =
    origInstance;
});

describe('Logger', () => {
  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = Logger.getInstance();
      const instance2 = Logger.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should be an instance of Logger', () => {
      const instance = Logger.getInstance();
      expect(instance).toBeInstanceOf(Logger);
    });
  });

  describe('formatError()', () => {
    it('should format error with name and message', () => {
      const error = new Error('Test error');
      const formatted = Logger.formatError(error);

      expect(formatted).toContain('Error: Test error');
    });

    it('should include stack trace when available', () => {
      const error = new Error('Test error');
      const formatted = Logger.formatError(error);

      expect(formatted).toContain('at ');
    });

    it('should handle errors without stack trace', () => {
      const error = new Error('Test error');
      delete error.stack;

      const formatted = Logger.formatError(error);

      expect(formatted).toContain('Error: Test error');
      expect(formatted).not.toContain('undefined');
    });

    it('should include extra properties on the error', () => {
      const error = new Error('Test error');
      (error as Error & { code: string }).code = 'ERR_TEST';

      const formatted = Logger.formatError(error);

      expect(formatted).toContain('code');
      expect(formatted).toContain('ERR_TEST');
    });
  });

  describe('setContext()', () => {
    it('should return the logger instance for chaining', () => {
      const logger = Logger.getInstance();
      const result = logger.setContext('TestContext');

      expect(result).toBe(logger);
    });
  });

  describe('Instance Methods', () => {
    it('should not throw when calling info()', () => {
      const logger = Logger.getInstance();
      expect(() => logger.info('test message')).not.toThrow();
    });

    it('should not throw when calling warn()', () => {
      const logger = Logger.getInstance();
      expect(() => logger.warn('test message')).not.toThrow();
    });

    it('should not throw when calling error()', () => {
      const logger = Logger.getInstance();
      expect(() => logger.error('test message')).not.toThrow();
    });

    it('should not throw when calling error() with an Error object', () => {
      const logger = Logger.getInstance();
      expect(() =>
        logger.error('test message', new Error('inner error')),
      ).not.toThrow();
    });

    it('should not throw when calling debug()', () => {
      const logger = Logger.getInstance();
      expect(() => logger.debug('test message')).not.toThrow();
    });

    it('should not throw when calling verbose()', () => {
      const logger = Logger.getInstance();
      expect(() => logger.verbose('test message')).not.toThrow();
    });
  });

  describe('Static Methods', () => {
    it('should delegate info() to the singleton instance', () => {
      expect(() => Logger.info('static info message')).not.toThrow();
    });

    it('should delegate warn() to the singleton instance', () => {
      expect(() => Logger.warn('static warn message')).not.toThrow();
    });

    it('should delegate error() to the singleton instance', () => {
      expect(() => Logger.error('static error message')).not.toThrow();
    });

    it('should delegate debug() to the singleton instance', () => {
      expect(() => Logger.debug('static debug message')).not.toThrow();
    });

    it('should delegate verbose() to the singleton instance', () => {
      expect(() => Logger.verbose('static verbose message')).not.toThrow();
    });

    it('should delegate setContext() to the singleton instance', () => {
      const result = Logger.setContext('StaticContext');
      expect(result).toBeInstanceOf(Logger);
    });
  });
});
