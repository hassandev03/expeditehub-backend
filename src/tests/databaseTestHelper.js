const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoMemoryServer;

async function startTestDatabase() {
  mongoMemoryServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoMemoryServer.getUri());
}

async function stopTestDatabase() {
  await mongoose.disconnect();
  await mongoMemoryServer.stop();
}

async function clearTestDatabaseCollections() {
  const databaseCollections = mongoose.connection.collections;
  for (const collectionName in databaseCollections) {
    await databaseCollections[collectionName].deleteMany({});
  }
}

module.exports = { startTestDatabase, stopTestDatabase, clearTestDatabaseCollections };
