const pgPool = require('../db/database');

class RecordStatusService {
  /**
   * Checks the status of records in the main table and error table
   * @param {string} tableName - Name of the main table (e.g., "canota")
   * @param {string} fieldId - The field name to use as identifier (e.g., "hash_id", "recno_id")
   * @param {Array} recordRequests - Array of objects with hash_id and id_cola
   * @param {string} clientId - Client identifier
   * @param {string} ver - Version identifier
   * @returns {Object} Status results for all records
   */
  async checkRecordsStatus(tableName, fieldId, recordRequests, clientId, ver) {
    const client = await pgPool.connect();
    
    try {
      const results = [];
      
      for (const request of recordRequests) {
        const recordId = request[fieldId]; // Use dynamic field_id
        const jobId = request.id_cola;
        
        try {
          // 1. Buscar en la tabla principal
          const mainTableResult = await this.checkMainTable(
            client, 
            tableName, 
            fieldId, 
            recordId, 
            clientId
          );
          
          if (mainTableResult.found) {
            // Registro encontrado en tabla principal - COMPLETED
            results.push({
              [fieldId]: recordId,
              status: 'COMPLETED',
              data: mainTableResult.data
            });
          } else {
            // 2. No encontrado en tabla principal, buscar en tabla de errores
            const errorTableResult = await this.checkErrorTable(
              client,
              tableName,
              recordId,
              clientId
            );
            
            if (errorTableResult.found) {
              // Registro encontrado en tabla de errores - ERROR
              results.push({
                [fieldId]: recordId,
                status: 'ERROR',
                error_details: errorTableResult.error_message,
                error_type: errorTableResult.error_type,
                data: null
              });
            } else {
              // 3. No encontrado en ninguna tabla - NOT_FOUND
              results.push({
                [fieldId]: recordId,
                status: 'NOT_FOUND',
                data: null
              });
            }
          }
          
        } catch (recordError) {
          // Error al procesar este registro específico
          results.push({
            [fieldId]: recordId,
            status: 'QUERY_ERROR',
            error_details: recordError.message,
            data: null
          });
        }
      }
      
      return {
        version: ver || '1.0',
        field_id: fieldId,
        table: tableName,
        client_id: clientId,
        total_records: recordRequests.length,
        records: results
      };
      
    } finally {
      client.release();
    }
  }
  
  /**
   * Check if record exists in main table
   */
  async checkMainTable(client, tableName, fieldId, recordId, clientId) {
    const query = `
      SELECT 
        _server_id,
        _${fieldId},
        _ver,
        _deleted
      FROM ${tableName.toLowerCase()}
      WHERE _${fieldId} = $1 
        AND _client_id = $2
      LIMIT 1
    `;
    
    const result = await client.query(query, [recordId, clientId]);
    
    if (result.rows.length > 0) {
      return {
        found: true,
        data: result.rows[0]
      };
    }
    
    return { found: false };
  }
  
  /**
   * Check if record exists in error table
   */
  async checkErrorTable(client, tableName, recordId, clientId) {
    const errorTableName = `${tableName.toLowerCase()}_errors`;
    
    const query = `
      SELECT 
        record_id,
        client_id,
        operation,
        error_type,
        error_message,
        field_id,
        record_data,
        created_at
      FROM ${errorTableName}
      WHERE record_id = $1 
        AND client_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `;
    
    try {
      const result = await client.query(query, [recordId, clientId]);
      
      if (result.rows.length > 0) {
        const errorRecord = result.rows[0];
        return {
          found: true,
          error_message: errorRecord.error_message,
          error_type: errorRecord.error_type,
          record_data: errorRecord.record_data,
          operation: errorRecord.operation,
          created_at: errorRecord.created_at
        };
      }
    } catch (error) {
      // Si la tabla de errores no existe, simplemente retornar not found
      console.warn(`Tabla de errores ${errorTableName} no existe o error al consultar:`, error.message);
    }
    
    return { found: false };
  }
}

module.exports = new RecordStatusService();
