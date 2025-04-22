// This file will be executed before running tests

// Mock timers
jest.useFakeTimers();

// Suppress console.log during tests
globalThis.console.log = jest.fn();

// Add any global test setup here
