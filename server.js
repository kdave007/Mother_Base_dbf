require('dotenv').config();
const express = require('express');
const Queue = require('bull');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Crear cola
const queue = new Queue('items-processing', {
  redis: { host:  process.env.REDIS_HOST, port: process.env.REDIS_PORT }
});

// Ruta DIRECTA (sin clases)
app.post('/items', async (req, res) => {
  console.log('📨 POST /items recibido');
  
  try {
    const { operation, records, table_name, client_id } = req.body;
    
    if (!operation || !records || !table_name) {
      return res.json({
        status: "error",
        msg: "Datos incompletos",
        status_id: "VALIDATION_ERROR",
        id_cola: null,
        status_code: 200
      });
    }
    
    const job = await queue.add('process_batch', req.body);
    console.log('✅ Job encolado:', job.id);
    
    res.json({
      status: "ok",
      msg: "Batch encolado exitosamente",
      status_id: "BATCH_QUEUED", 
      id_cola: job.id,
      status_code: 200
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.json({
      status: "error",
      msg: `Error: ${error.message}`,
      status_id: "QUEUE_ERROR",
      id_cola: null,
      status_code: 200
    });
  }
});

// Worker
queue.process('process_batch', async (job) => {
  console.log('🎯 Procesando:', job.data.table_name);
  return { success: true };
});

// Ruta de prueba
app.get('/', (req, res) => {
  res.json({ message: 'Server working! Use POST /items' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  console.log(`📤 Usa POST http://localhost:${PORT}/items`);
});