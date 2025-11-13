const pgPool = require('../db/database');
const operationsRepository = require('../repositories/operationsRepository');

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
          // 1. PRIMERO: Buscar en tabla de operaciones (fuente de verdad)
          const op = await operationsRepository.findOperationByRecord(
            tableName,
            recordId,
            clientId,
            ver
          );
          
          if (op) {
            const { operation, status, error_message } = op;
            
            // QUEUED o PROCESSING -> Status: PROCESSING
            if (status === 'QUEUED' || status === 'PROCESSING') {
              results.push({
                [fieldId]: recordId,
                status: 'PROCESSING',
                note: `Operation ${operation} is ${status}`,
                data: null
              });
            }
            // ERROR -> Status: ERROR (excepto casos especiales)
            else if (status === 'ERROR') {
              // Verificar si es un caso especial que debe reportarse como COMPLETED
              const isDuplicateBypass = operation === 'CREATE' && 
                error_message && 
                (error_message.includes('Duplicate bypassed') || 
                 error_message.includes('duplicate') ||
                 error_message.includes('already exists'));
              
              const isDeleteNotFoundBypass = operation === 'DELETE' && 
                error_message && 
                (error_message.includes('Delete not found bypassed') ||
                 error_message.includes('not found') ||
                 error_message.includes('no encontrado'));
              
              if (isDuplicateBypass || isDeleteNotFoundBypass) {
                results.push({
                  [fieldId]: recordId,
                  status: 'COMPLETED',
                  note: isDuplicateBypass ? 'Duplicate bypassed' : 'Delete not found bypassed',
                  data: null
                });
              } else {
                // Error real
                results.push({
                  [fieldId]: recordId,
                  status: 'ERROR',
                  error_details: error_message,
                  data: null
                });
              }
            }
            // COMPLETED -> Verificar en tabla principal para obtener datos
            else if (status === 'COMPLETED') {
              // Para DELETE COMPLETED, no buscar en tabla principal
              if (operation === 'DELETE') {
                results.push({
                  [fieldId]: recordId,
                  status: 'COMPLETED',
                  note: 'Record was deleted',
                  data: null
                });
              } else {
                // Para CREATE/UPDATE COMPLETED, verificar tabla principal y validar consistencia
                const mainTableResult = await this.checkMainTable(
                  client, 
                  tableName, 
                  fieldId, 
                  recordId, 
                  clientId,
                  ver
                );
                
                if (!mainTableResult.found) {
                  // INCONSISTENCIA DETECTADA: marcado como COMPLETED pero no existe
                  results.push({
                    [fieldId]: recordId,
                    status: 'ERROR',
                    error_details: `Operation ${operation} marked as COMPLETED but record not found in main table. Possible causes: manual deletion, transaction rollback, or database inconsistency.`,
                    data: null
                  });
                } else {
                  // COMPLETED VÁLIDO: operación exitosa y registro existe
                  results.push({
                    [fieldId]: recordId,
                    status: 'COMPLETED',
                    data: mainTableResult.data
                  });
                }
              }
            }
            // Cualquier otro status
            else {
              results.push({
                [fieldId]: recordId,
                status: 'NOT_FOUND',
                note: `Unknown operation status: ${status}`,
                data: null
              });
            }
          } else {
            // 2. SEGUNDO: Si no hay operación registrada, buscar en tabla principal
            const mainTableResult = await this.checkMainTable(
              client, 
              tableName, 
              fieldId, 
              recordId, 
              clientId,
              ver
            );
            
            if (mainTableResult.found) {
              // Operations faltante pero registro existe - ERROR para forzar reenvío
              results.push({
                [fieldId]: recordId,
                status: 'ERROR',
                error_details: 'Operation record missing but data exists in main table - please resend to recreate operation history',
                data: null
              });
            } else {
              // 3. No encontrado en ninguna tabla
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
  async checkMainTable(client, tableName, fieldId, recordId, clientId, ver) {
    const query = `
      SELECT 
        _server_id,
        _${fieldId},
        _ver,
        _deleted,
        _hash_comparador
      FROM ${tableName.toLowerCase()}
      WHERE _${fieldId} = $1 
        AND _client_id = $2
        AND _ver = $3
      LIMIT 1
    `;
    
    const result = await client.query(query, [recordId, clientId, ver]);
    
    if (result.rows.length > 0) {
      return {
        found: true,
        data: result.rows[0]
      };
    }
    
    return { found: false };
  }
  
}

module.exports = new RecordStatusService();
