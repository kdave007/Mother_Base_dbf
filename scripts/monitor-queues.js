const Queue = require('bull');
require('dotenv').config();

const queue = new Queue('items-processing', {
  redis: { host:  process.env.REDIS_HOST, port: process.env.REDIS_PORT }
});

async function monitor() {
  const counts = await queue.getJobCounts();
  console.log('  Estado de cola:');
  console.log('- Waiting:', counts.waiting);
  console.log('- Active:', counts.active);
  console.log('- Completed:', counts.completed);
  console.log('- Failed:', counts.failed);
  
  process.exit(0);
}

monitor();