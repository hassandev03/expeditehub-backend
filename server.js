require('dotenv').config();
const http = require('http');
const expressApplication = require('./app');
const { connectToDatabase } = require('./config/db');
const { initSocket } = require('./src/sockets/socketManager');
const { kafkaProducer } = require('./config/kafka');
const { startMidnightResetCronJobs } = require('./src/jobs/midnightReset');
const { startDelayedOrderAlertCronJob } = require('./src/jobs/delayedOrderAlert');

const httpServer = http.createServer(expressApplication);
initSocket(httpServer);

const applicationPortNumber = process.env.PORT || 5000;

connectToDatabase()
  .then(async () => {
    await kafkaProducer.connect();
    console.log('Kafka producer connected');
    httpServer.listen(applicationPortNumber, () => {
      console.log(`ExpediteHub server running on port ${applicationPortNumber}`);
    });
    startMidnightResetCronJobs();
    startDelayedOrderAlertCronJob();
  })
  .catch((databaseConnectionError) => {
    console.error('Failed to connect to MongoDB:', databaseConnectionError.message);
    process.exit(1);
  });
