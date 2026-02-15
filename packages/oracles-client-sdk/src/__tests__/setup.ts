// This file will be executed before running tests

// Mock timers
vi.useFakeTimers();

// Suppress console.log during tests
globalThis.console.log = vi.fn();

// Add any global test setup here
