const Queue = require('bull');

class QueueManager {
  constructor() {
    this.queues = {};
  }
  
  getQueue(name) {
    if (!this.queues[name]) {
      this.queues[name] = new Queue(name, {
        redis: { host:  process.env.REDIS_HOST, port: process.env.REDIS_PORT }
      });
    }
    return this.queues[name];
  }
}

module.exports = new QueueManager();