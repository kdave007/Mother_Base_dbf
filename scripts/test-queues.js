const Queue = require('bull');

const testQueue = new Queue('items-processing', {
  redis: { host: '127.0.0.1', port: 6379 }
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