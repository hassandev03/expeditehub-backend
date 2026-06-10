const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'expeditehub-api',
  brokers: [process.env.KAFKA_BOOTSTRAP_SERVERS],
  ssl: true,
  sasl: {
    mechanism: 'plain',
    username: process.env.KAFKA_SASL_USERNAME,
    password: process.env.KAFKA_SASL_PASSWORD,
  },
});

const kafkaProducer = kafka.producer();

module.exports = { kafkaProducer };
