const Redis = require('ioredis');

class RedisClient {
  constructor() {
    this.client = null;
  }

  async connect() {
    if (this.client) {
      return this.client;
    }

    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    this.client.on('connect', () => {
      console.log('Redis Client Connected');
    });

    return this.client;
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  getClient() {
    if (!this.client) {
      throw new Error('Redis client not connected. Call connect() first.');
    }
    return this.client;
  }
}

module.exports = new RedisClient();
