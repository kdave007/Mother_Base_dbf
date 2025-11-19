const Queue = require('bull');
const postgresService = require('../services/postgresService');
const schemaService = require('../services/schemaService');
const logger = require('../utils/logger'); // ← Nuevo logger
require('dotenv').config();

// Helper para formatear fecha/hora en timezone de México
function getMexicoCityTime() {
  return new Date().toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

// Helper para formatear duración en formato legible
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(2);
  return `${minutes}m ${seconds}s`;
}

// Contadores de ventana para benchmarks periódicos
let windowStartTime = Date.now();
let windowJobs = 0;
let windowDurationMs = 0;
let windowRecords = 0;

const queue = new Queue('items-processing', {
  redis: { host:  process.env.REDIS_HOST, port: process.env.REDIS_PORT }
});

queue.process('process_batch', async (job) => {
  const { operation, records, table_name, client_id, field_id, ver } = job.data;
  
  // Marcar inicio de procesamiento
  const startTime = Date.now();
  const startDateTime = getMexicoCityTime();
  
  await logger.info('🚀 Iniciando procesamiento de batch', {
    job_id: job.id,
    operation,
    table: table_name,
    client: client_id,
    records_count: records.length,
    field_id,
    start_time: startDateTime
  });
  
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`🚀 JOB INICIADO - ${startDateTime}`);
  console.log(`   Job ID: ${job.id}`);
  console.log(`   Operación: ${operation}`);
  console.log(`   Tabla: ${table_name}`);
  console.log(`   Cliente: ${client_id}`);
  console.log(`   Registros: ${records.length}`);
  console.log(`[${'='.repeat(60)}]\n`);

  try {
    // 1. Cargar schema de la tabla
    const tableSchema = await schemaService.loadTableSchema(table_name);
    
    if (!tableSchema) {
      await logger.warn('Schema no encontrado', { table: table_name });
    }
    // 2. Procesar según la operación
    let results;
    if (operation === 'create' || operation === 'update' || operation === 'delete') {
      results = await postgresService.saveRecords(
        records,
        table_name,
        client_id,
        field_id,
        operation,
        tableSchema,
        job.id,
        ver
      );
    } else {
      results = [{ status: 'error', error: `Operación no soportada: ${operation}` }];
    }

    // 3. Calcular estadísticas y tiempo
    const endTime = Date.now();
    const endDateTime = getMexicoCityTime();
    const duration = endTime - startTime;
    const throughput = records.length / (duration / 1000); // registros por segundo
    
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    // 4. Log de resultados con timing
    await logger.info('✅ Batch procesado exitosamente', {
      job_id: job.id,
      operation,
      table: table_name,
      success_count: successCount,
      error_count: errorCount,
      total_records: records.length,
      duration_ms: duration,
      duration_formatted: formatDuration(duration),
      throughput: `${throughput.toFixed(2)} rec/s`,
      start_time: startDateTime,
      end_time: endDateTime
    });
    
    console.log(`\n[${'='.repeat(60)}]`);
    console.log(`✅ JOB COMPLETADO - ${endDateTime}`);
    console.log(`   Job ID: ${job.id}`);
    console.log(`   Duración: ${formatDuration(duration)}`);
    console.log(`   Throughput: ${throughput.toFixed(2)} rec/s`);
    console.log(`   Exitosos: ${successCount}/${records.length}`);
    console.log(`   Errores: ${errorCount}/${records.length}`);
    console.log(`[${'='.repeat(60)}]\n`);

    // 5. Log detallado de errores
    if (errorCount > 0) {
      const errors = results.filter(r => r.status === 'error')
        .map(e => ({ record_id: e.record_id, error: e.error }));
      
      await logger.error('Errores en batch', {
        job_id: job.id,
        errors: errors
      });
    }

    return {
      success: errorCount === 0,
      operation: operation,
      records_processed: records.length,
      saved_successfully: successCount,
      save_errors: errorCount,
      table: table_name,
      detailed_results: results
    };

  } catch (error) {
    const endTime = Date.now();
    const endDateTime = getMexicoCityTime();
    const duration = endTime - startTime;
    
    await logger.error('❌ Error procesando batch', {
      job_id: job.id,
      operation,
      table: table_name,
      error: error.message,
      stack: error.stack,
      duration_ms: duration,
      duration_formatted: formatDuration(duration),
      start_time: startDateTime,
      end_time: endDateTime
    });
    
    console.log(`\n[${'='.repeat(60)}]`);
    console.log(`❌ JOB FALLIDO - ${endDateTime}`);
    console.log(`   Job ID: ${job.id}`);
    console.log(`   Duración: ${formatDuration(duration)}`);
    console.log(`   Error: ${error.message}`);
    console.log(`[${'='.repeat(60)}]\n`);
    
    throw error;
  }
});

// Benchmark periódico por ventana de tiempo (ej. cada 60s)
const BENCHMARK_WINDOW_MS = 600000; // 60 segundos
setInterval(async () => {
  const now = Date.now();
  const windowLengthMs = now - windowStartTime;
  const windowLengthSec = windowLengthMs / 1000;
  
  if (windowJobs > 0 && windowLengthSec > 0) {
    const avgJobTimeMs = windowDurationMs / windowJobs;
    const overallThroughput = windowRecords / windowLengthSec;
    
    await logger.info('📊 Ventana de benchmark de jobs', {
      window_seconds: windowLengthSec,
      jobs: windowJobs,
      total_job_time_ms: windowDurationMs,
      avg_job_time_ms: avgJobTimeMs,
      total_records: windowRecords,
      overall_throughput: `${overallThroughput.toFixed(2)} rec/s`
    });
  }
  
  // Reiniciar ventana
  windowStartTime = now;
  windowJobs = 0;
  windowDurationMs = 0;
  windowRecords = 0;
}, BENCHMARK_WINDOW_MS);

// Eventos de la cola con logging
queue.on('completed', async (job, result) => {
  const duration = job.finishedOn - job.processedOn;
  const completedTime = getMexicoCityTime();
  
  await logger.info('🎉 Batch completado exitosamente', {
    job_id: job.id,
    table: result.table,
    operation: result.operation,
    success_count: result.saved_successfully,
    error_count: result.save_errors,
    duration_ms: duration,
    duration_formatted: formatDuration(duration),
    completed_at: completedTime
  });
  
  console.log(`[${completedTime}] 🎉 Job ${job.id} completado - ${formatDuration(duration)}`);
  
  // Actualizar contadores de ventana para benchmarks
  windowJobs += 1;
  windowDurationMs += duration;
  if (result && typeof result.records_processed === 'number') {
    windowRecords += result.records_processed;
  }
});

queue.on('failed', async (job, error) => {
  const failedTime = getMexicoCityTime();
  
  await logger.error('💥 Batch fallido', {
    job_id: job.id,
    table: job.data.table_name,
    operation: job.data.operation,
    error: error.message,
    attempts: job.attemptsMade,
    failed_at: failedTime
  });
  
  console.log(`[${failedTime}] 💥 Job ${job.id} fallido después de ${job.attemptsMade} intentos`);
});

queue.on('stalled', async (job) => {
  const stalledTime = getMexicoCityTime();
  
  await logger.warn('⚠️  Job estancado', {
    job_id: job.id,
    table: job.data.table_name,
    stalled_at: stalledTime
  });
  
  console.log(`[${stalledTime}] ⚠️  Job ${job.id} estancado`);
});

module.exports = queue;