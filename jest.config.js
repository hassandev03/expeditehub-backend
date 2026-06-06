/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  testTimeout: 120000,
  testMatch: ['**/__tests__/**/*.test.js'],
  // Run a global setup to pre-download the MongoDB binary before any test file starts.
  // This ensures the 60s beforeAll timeout in each suite is not consumed by the download.
  globalSetup: './src/tests/globalSetup.js'
};

module.exports = config;
