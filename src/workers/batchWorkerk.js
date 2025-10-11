const Queue = require('bull');
const postgresService = require('../services/postgresService');
const schemaService = require('../services/schemaService'); // ← Nuevo

const queue = new Queue('items-processing', {
  redis: { host: '127.0.0.1', port: 6379 }
});

queue.process('process_batch', async (job) => {
  console.log('🎯 Procesando batch:', job.data.table_name);
  
  try {
    // Cargar schema de la tabla
    const tableSchema = await schemaService.loadTableSchema(job.data.table_name);
    
    const saveResults = await postgresService.saveRecords(
      job.data.records,
      job.data.table_name,
      job.data.client_id,
      job.data.field_id, 
      job.data.operation,
      tableSchema  // ← Schema pasado al servicio
    );
    
    const successCount = saveResults.filter(r => r.status === 'success').length;
    const errorCount = saveResults.filter(r => r.status === 'error').length;
    
    console.log(`✅ Guardados: ${successCount}, ❌ Errores: ${errorCount}`);
    
    return {
      success: true,
      records_processed: job.data.records.length,
      saved_successfully: successCount,
      save_errors: errorCount,
      table: job.data.table_name,
      detailed_results: saveResults
    };
    
  } catch (error) {
    console.error('❌ Error procesando batch:', error);
    throw error;
  }
});

module.exports = queue;