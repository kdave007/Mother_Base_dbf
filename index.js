

require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CONFIGURACIÓN PARA NDJSON
// app.use(express.json({ limit: '100mb' })); // Para JSON tradicional
app.use(express.json()); // Para JSON tradicional
app.use(express.text({ 
  limit: '100mb', 
  type: 'text/plain'  // Para NDJSON
}));

// ✅ Importar servicios para verificación
const ActivityTracker = require('./src/middleware/activityTracker');
const schemaService = require('./src/services/schemaService');
const logger = require('./src/utils/logger');
const { testPostgresConnection } = require('./src/services/dbHealthService');
const redisClient = require('./src/config/redisClient');
const { initializeAuthMiddleware } = require('./src/middleware/auth');

// ✅ Activity Tracker Middleware (tracks client activity)
const activityTracker = new ActivityTracker();
app.use(activityTracker.middleware());

// ✅ Función de verificaciones de startup
async function startupChecks() {
  console.log('🔍 Realizando verificaciones de inicio...');
  
  try {
    // 1. Verificar logger
    await logger.info('Iniciando aplicación - prueba de logger');
    console.log('✅ Logger funcionando correctamente');
    
    // 2. Verificar PostgreSQL
    const pgTest = await testPostgresConnection();
    if (pgTest.success) {
      await logger.info('PostgreSQL conectado correctamente', {
        database: pgTest.database,
        version: pgTest.version
      });
      console.log('✅ PostgreSQL conectado correctamente');
    } else {
      throw new Error(`PostgreSQL error: ${pgTest.error}`);
    }
    
    // 3. Conectar Redis
    await redisClient.connect();
    console.log('✅ Redis conectado correctamente');
    await logger.info('Redis conectado correctamente');
    
    // 4. Inicializar servicio de autenticación y cargar API keys a cache
    const apiKeyService = await initializeAuthMiddleware();
    console.log('✅ Servicio de autenticación inicializado con API keys desde DB');
    await logger.info('API Key service inicializado');
    
    // 5. Verificar schema service
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

// ✅ Ruta de salud extendida
app.get('/health', async (req, res) => {
  try {
    const pgTest = await testPostgresConnection();
    let redisStatus = 'disconnected';
    
    try {
      const redis = redisClient.getClient();
      await redis.ping();
      redisStatus = 'connected';
    } catch (err) {
      redisStatus = 'error';
    }
    
    res.json({ 
      status: 'ok', 
      message: 'Servidor funcionando',
      timestamp: new Date().toISOString(),
      services: {
        postgresql: pgTest.success ? 'connected' : 'error',
        database: pgTest.database || 'unknown',
        redis: redisStatus,
        worker: 'running'
      },
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Error en health check',
      error: error.message
    });
  }
});

// ✅ Ruta específica para test de PostgreSQL
app.get('/health/db', async (req, res) => {
  try {
    const result = await testPostgresConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ✅ Iniciar servidor después de las verificaciones
async function startServer() {
  await startupChecks();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
    console.log(`📤 Endpoint: POST http://localhost:${PORT}/items`);
    console.log(`❤️  Health: GET http://localhost:${PORT}/health`);
    console.log(`🗄️  DB Health: GET http://localhost:${PORT}/health/db`);
    console.log(`🔧 Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📂 Directorio: ${process.cwd()}`);
    console.log(`📝 Formatos soportados: JSON y NDJSON (text/plain)`);
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

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await activityTracker.shutdown();
  await redisClient.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await activityTracker.shutdown();
  await redisClient.disconnect();
  process.exit(0);
});

// ✅ Iniciar la aplicación
startServer();