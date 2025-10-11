const Queue = require('bull');

class QueueManager {
  constructor() {
    this.queues = {};
  }
  
  getQueue(name) {
    if (!this.queues[name]) {
      this.queues[name] = new Queue(name, {
        redis: { host: '127.0.0.1', port: 6379 }
      });
    }
    return this.queues[name];
  }
}

module.exports = new QueueManager();