const Queue = require('bull');

const queue = new Queue('items-processing', {
  redis: { host: '127.0.0.1', port: 6379 }
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