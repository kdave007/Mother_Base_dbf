const Queue = require('bull');

const testQueue = new Queue('test');

testQueue.add('test-job', { message: 'Hola Redis!' });
console.log('Redis funcionando con Bull!');

testQueue.process('test-job', (job) => {
  console.log('Procesado:', job.data);
});