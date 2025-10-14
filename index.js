// require('dotenv').config();
// const express = require('express');
// const app = express();
// const PORT = process.env.PORT || 3000;

// app.use(express.json());

// // ✅ Worker avanzado se auto-inicia
// require('./src/workers/batchWorker');

// // Routes
// const ItemsRoute = require('./src/routes/itemsRoute');
// new ItemsRoute(app);

// // Ruta de salud
// app.get('/health', (req, res) => {
//   res.json({ 
//     status: 'ok', 
//     message: 'Servidor funcionando',
//     timestamp: new Date().toISOString()
//   });
// });

// app.listen(PORT, () => {
//   console.log(`🚀 Server running at http://localhost:${PORT}`);
//   console.log(`📤 Endpoint: POST http://localhost:${PORT}/items`);
//   console.log(`❤️  Health: GET http://localhost:${PORT}/health`);
// });


require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ✅ Importar servicios para verificación
const schemaService = require('./src/services/schemaService');
const logger = require('./src/utils/logger');

// ✅ Función de verificaciones de startup
async function startupChecks() {
  console.log('🔍 Realizando verificaciones de inicio...');
  
  try {
    // 1. Verificar logger
    await logger.info('Iniciando aplicación - prueba de logger');
    console.log('✅ Logger funcionando correctamente');
    
    // 2. Verificar schema service
    const testSchema = await schemaService.loadTableSchema('XCORTE');
    if (testSchema) {
      await logger.info('Schema service funcionando', {
        tabla: 'XCORTE',
        campos: Object.keys(testSchema).length
      });
      console.log('✅ Schema service funcionando correctamente');
    } else {
      throw new Error('No se pudo cargar schema de prueba');
    }
    
    // 3. Verificar Redis (si es necesario)
    // await verifyRedisConnection();
    
    console.log('🎯 Todas las verificaciones pasaron');
    
  } catch (error) {
    console.error('❌ Error en verificaciones de inicio:', error.message);
    await logger.error('Error en startup checks', { error: error.message });
    // No salir del proceso, solo loggear el error
  }
}

// ✅ Worker avanzado se auto-inicia
require('./src/workers/batchWorker');

// Routes
const ItemsRoute = require('./src/routes/itemsRoute');
new ItemsRoute(app);

// Ruta de salud
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Servidor funcionando',
    timestamp: new Date().toISOString()
  });
});

// ✅ Iniciar servidor después de las verificaciones
async function startServer() {
  await startupChecks();
  
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📤 Endpoint: POST http://localhost:${PORT}/items`);
    console.log(`❤️  Health: GET http://localhost:${PORT}/health`);
    console.log(`🔧 Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📂 Directorio: ${process.cwd()}`);
  });
}

// Manejo de errores no capturados
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  logger.error('Unhandled Promise Rejection', { error: err.message });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  logger.error('Uncaught Exception', { error: err.message });
  process.exit(1);
});

// ✅ Iniciar la aplicación
startServer();