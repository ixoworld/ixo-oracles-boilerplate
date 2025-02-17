import '@testing-library/jest-dom';

// Make React available globally
import React from 'react';
global.React = React;

// Mock fetch globally
global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({}),
  }),
);

// Silence React 18 console warnings in tests
beforeAll(() => {
  console.error = jest.fn();
  console.warn = jest.fn();
});
