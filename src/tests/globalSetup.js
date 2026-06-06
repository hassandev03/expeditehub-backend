/**
 * Jest globalSetup runs once before all test suites in a single Node process
 * with no timeout by default. This is the right place to trigger the
 * mongodb-memory-server binary download so individual suite beforeAll hooks
 * are not blocked by it.
 */
const { MongoBinaryDownloadUrl } = require('mongodb-memory-server-core/lib/util/MongoBinaryDownloadUrl');
const { MongoBinary } = require('mongodb-memory-server-core');

module.exports = async function globalSetup() {
  console.log('\n[globalSetup] Pre-downloading MongoDB binary for tests...');
  try {
    const binaryPath = await MongoBinary.getPath({ version: process.env.MONGOMS_VERSION || '7.0.24' });
    console.log(`[globalSetup] MongoDB binary ready at: ${binaryPath}`);
  } catch (downloadError) {
    console.error('[globalSetup] Failed to pre-download MongoDB binary:', downloadError.message);
    // Do not throw — individual test suites will handle their own startup failures
  }
};
