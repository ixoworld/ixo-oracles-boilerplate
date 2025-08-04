/* eslint-disable turbo/no-undeclared-env-vars -- test */
import  z  from 'zod';
import { EnvService } from './env.service.js';

describe('EnvService', () => {
  // Store original process.env
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
    // Reset the singleton instance
    // @ts-expect-error accessing private static for testing
    EnvService.instance = null;
  });

  afterAll(() => {
    // Restore original process.env
    process.env = originalEnv;
  });

  describe('initialization', () => {
    it('should initialize with valid environment variables', () => {
      // Arrange
      const schema = z.object({
        TEST_VAR: z.string(),
        TEST_NUMBER: z.coerce.number(),
      });
      process.env.TEST_VAR = 'test';
      process.env.TEST_NUMBER = '123';

      // Act
      const envService = EnvService.initialize(schema);

      // Assert
      expect(envService.get('TEST_VAR')).toBe('test');
      expect(envService.get('TEST_NUMBER')).toBe(123);
    });

    it('should throw error when required environment variables are missing', () => {
      // Arrange
      const schema = z.object({
        MISSING_VAR: z.string(),
      });

      // Act & Assert
      expect(() => EnvService.initialize(schema)).toThrow();
    });

    it('should maintain singleton instance', () => {
      // Arrange
      const schema = z.object({
        TEST_VAR: z.string(),
      });
      process.env.TEST_VAR = 'test';

      // Act
      const instance1 = EnvService.initialize(schema);
      const instance2 = EnvService.initialize(schema);

      // Assert
      expect(instance1).toBe(instance2);
    });
  });

  describe('getInstance', () => {
    it('should throw error when accessing getInstance before initialization', () => {
      // Act & Assert
      expect(() => EnvService.getInstance()).toThrow(
        'EnvService must be initialized with a schema first',
      );
    });

    it('should return initialized instance', () => {
      // Arrange
      const schema = z.object({
        TEST_VAR: z.string(),
      });
      process.env.TEST_VAR = 'test';
      const initializedInstance = EnvService.initialize(schema);

      // Act
      const instance = EnvService.getInstance();

      // Assert
      expect(instance).toBe(initializedInstance);
    });
  });

  describe('environment access', () => {
    it('should return all environment variables', () => {
      // Arrange
      const schema = z.object({
        TEST_VAR1: z.string(),
        TEST_VAR2: z.string(),
      });
      process.env.TEST_VAR1 = 'value1';
      process.env.TEST_VAR2 = 'value2';
      const envService = EnvService.initialize(schema);

      // Act
      const allEnv = envService.getAll();

      // Assert
      expect(allEnv).toEqual({
        TEST_VAR1: 'value1',
        TEST_VAR2: 'value2',
      });
    });

    it('should handle transformed values correctly', () => {
      // Arrange
      const schema = z.object({
        NUMBER: z.string().transform(Number),
        BOOLEAN: z.string().transform((val) => val === 'true'),
      });
      process.env.NUMBER = '42';
      process.env.BOOLEAN = 'true';
      const envService = EnvService.initialize(schema);

      // Act & Assert
      expect(envService.get('NUMBER')).toBe(42);
      expect(envService.get('BOOLEAN')).toBe(true);
    });
  });

  describe('validation', () => {
    it('should validate enum values', () => {
      // Arrange
      const schema = z.object({
        NODE_ENV: z.enum(['development', 'production', 'test']),
      });
      process.env.NODE_ENV = 'development';

      // Act
      const envService = EnvService.initialize(schema);

      // Assert
      expect(envService.get('NODE_ENV')).toBe('development');
    });

    it('should throw on invalid enum values', () => {
      // Arrange
      const schema = z.object({
        NODE_ENV: z.enum(['development', 'production', 'test']),
      });
      process.env.NODE_ENV = 'invalid';

      // Act & Assert
      expect(() => EnvService.initialize(schema)).toThrow();
    });
  });
});
