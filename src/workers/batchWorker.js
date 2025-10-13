const Queue = require('bull');
const postgresService = require('../services/postgresService');
const schemaService = require('../services/schemaService');
const logger = require('../utils/logger'); // ← Nuevo logger

const queue = new Queue('items-processing', {
  redis: { host: '127.0.0.1', port: 6379 }
});

queue.process('process_batch', async (job) => {
  const { operation, records, table_name, client_id, field_id } = job.data;
  
  await logger.info('Iniciando procesamiento de batch', {
    job_id: job.id,
    operation,
    table: table_name,
    client: client_id,
    records_count: records.length,
    field_id
  });

  try {
    // 1. Cargar schema de la tabla
    const tableSchema = await schemaService.loadTableSchema(table_name);
    
    if (!tableSchema) {
      await logger.warn('Schema no encontrado', { table: table_name });
    }

    // 2. Procesar según la operación
    let results;
    if (operation === 'create') {
      results = await postgresService.saveRecords(
        records,
        table_name,
        client_id,
        field_id,
        operation,
        tableSchema
      );
    } else {
      results = [{ status: 'error', error: `${operation} no implementado aún` }];
    }

    // 3. Calcular estadísticas
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    // 4. Log de resultados
    await logger.info('Batch procesado', {
      job_id: job.id,
      operation,
      table: table_name,
      success_count: successCount,
      error_count: errorCount,
      total_records: records.length
    });

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
    await logger.error('Error procesando batch', {
      job_id: job.id,
      operation,
      table: table_name,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
});

// Eventos de la cola con logging
queue.on('completed', async (job, result) => {
  await logger.info('Batch completado exitosamente', {
    job_id: job.id,
    table: result.table,
    operation: result.operation,
    success_count: result.saved_successfully,
    error_count: result.save_errors,
    duration: job.finishedOn - job.processedOn
  });
});

queue.on('failed', async (job, error) => {
  await logger.error('Batch fallido', {
    job_id: job.id,
    table: job.data.table_name,
    operation: job.data.operation,
    error: error.message,
    attempts: job.attemptsMade
  });
});

queue.on('stalled', async (job) => {
  await logger.warn('Job estancado', {
    job_id: job.id,
    table: job.data.table_name
  });
});

module.exports = queue;