const Queue = require('bull');
require('dotenv').config();

const testQueue = new Queue('items-processing', {
  redis: { host:  process.env.REDIS_HOST, port: process.env.REDIS_PORT }
});

// Probar encolamiento
async function testEnqueue() {
  const job = await testQueue.add('process_batch', {
    operation: 'create',
    records: [{ test: 'data' }],
    table_name: 'TEST_TABLE',
    client_id: 'TEST_CLIENT'
  });
  
  console.log('✅ Job encolado:', job.id);
}

// Probar worker
testQueue.process('process_batch', async (job) => {
  console.log('🔄 Procesando:', job.data);
  return { success: true };
});

testEnqueue();

// Cerrar después de prueba
setTimeout(() => {
  testQueue.close();
  process.exit(0);
}, 5000);