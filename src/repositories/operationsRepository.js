const pgPool = require('../db/database');

/**
 * Repository for managing _OPERATIONS tables
 * Handles all database queries related to operation tracking
 */
class OperationsRepository {
  /**
   * Save an operation record to the _OPERATIONS table
   * New structure: PRIMARY KEY (client_id, batch_version, record_id)
   * @param {Object} params - Operation parameters
   * @returns {Promise<void>}
   */
  async saveOperation({ 
    tableName, 
    recordId, 
    clientId, 
    operation, 
    status, 
    error, 
    fieldId, 
    inputData, 
    batchVersion, 
    batchId  // job_id from queue
  }) {
    const client = await pgPool.connect();
    
    try {
      const operationsTableName = `${tableName.toLowerCase()}_operations`;
      const errorMessage = error ? (error.message || String(error)) : null;
      
      // Truncar valores para ajustarse a los límites de la tabla
      const truncatedClientId = clientId ? String(clientId).substring(0, 100) : null;
      const truncatedRecordId = recordId ? String(recordId).substring(0, 100) : null;
      const truncatedOperation = operation ? String(operation).toUpperCase().substring(0, 10) : null;
      const truncatedStatus = status ? String(status).toUpperCase().substring(0, 20) : 'ERROR';
      const truncatedFieldId = fieldId ? String(fieldId).substring(0, 50) : null;
      const truncatedBatchVersion = batchVersion ? String(batchVersion).substring(0, 100) : null;
      const truncatedBatchId = batchId ? String(batchId).substring(0, 100) : null;
      
      const query = `
        INSERT INTO ${operationsTableName} 
        (client_id, record_id, batch_version, field_id, operation, status, error_message, 
         batch_id, created_at, processed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (client_id, batch_version, record_id) 
        DO UPDATE SET 
          field_id = EXCLUDED.field_id,
          operation = EXCLUDED.operation,
          status = EXCLUDED.status,
          error_message = EXCLUDED.error_message,
          batch_id = EXCLUDED.batch_id,
          processed_at = CURRENT_TIMESTAMP
      `;
      
      await client.query(query, [
        truncatedClientId,
        truncatedRecordId,
        truncatedBatchVersion,
        truncatedFieldId,
        truncatedOperation,
        truncatedStatus,
        errorMessage,
        truncatedBatchId
      ]);
      
    } catch (saveError) {
      console.error('Error al guardar en tabla de operaciones:', saveError);
      // No lanzamos el error para no interrumpir el flujo principal
    } finally {
      client.release();
    }
  }

  async saveOperationsBatch(operations) {
    if (!operations || operations.length === 0) return;

    const client = await pgPool.connect();
    
    try {
      const first = operations[0];
      const operationsTableName = `${first.tableName.toLowerCase()}_operations`;

      const values = [];
      const rowsPlaceholders = [];
      let paramIndex = 1;

      for (const op of operations) {
        const errorMessage = op.error ? (op.error.message || String(op.error)) : null;

        const truncatedClientId = op.clientId ? String(op.clientId).substring(0, 100) : null;
        const truncatedRecordId = op.recordId ? String(op.recordId).substring(0, 100) : null;
        const truncatedOperation = op.operation ? String(op.operation).toUpperCase().substring(0, 10) : null;
        const truncatedStatus = op.status ? String(op.status).toUpperCase().substring(0, 20) : 'ERROR';
        const truncatedFieldId = op.fieldId ? String(op.fieldId).substring(0, 50) : null;
        const truncatedBatchVersion = op.batchVersion ? String(op.batchVersion).substring(0, 100) : null;
        const truncatedBatchId = op.batchId ? String(op.batchId).substring(0, 100) : null;

        const rowPlaceholders = [];
        for (let i = 0; i < 8; i++) {
          rowPlaceholders.push(`$${paramIndex++}`);
        }

        rowsPlaceholders.push(`(${rowPlaceholders.join(', ')}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);

        values.push(
          truncatedClientId,
          truncatedRecordId,
          truncatedBatchVersion,
          truncatedFieldId,
          truncatedOperation,
          truncatedStatus,
          errorMessage,
          truncatedBatchId
        );
      }

      const query = `
        INSERT INTO ${operationsTableName} 
        (client_id, record_id, batch_version, field_id, operation, status, error_message, 
         batch_id, created_at, processed_at)
        VALUES ${rowsPlaceholders.join(', ')}
        ON CONFLICT (client_id, batch_version, record_id) 
        DO UPDATE SET 
          field_id = EXCLUDED.field_id,
          operation = EXCLUDED.operation,
          status = EXCLUDED.status,
          error_message = EXCLUDED.error_message,
          batch_id = EXCLUDED.batch_id,
          processed_at = CURRENT_TIMESTAMP
      `;

      await client.query(query, values);

    } catch (saveError) {
      console.error('Error al guardar batch en tabla de operaciones:', saveError);
    } finally {
      client.release();
    }
  }

  /**
   * Find the most recent operation for a record
   * @param {string} tableName - Name of the main table
   * @param {string} recordId - Record identifier
   * @param {string} clientId - Client identifier
   * @param {string} batchVersion - Batch version
   * @returns {Promise<Object|null>} Operation record or null if not found
   */
  async findOperationByRecord(tableName, recordId, clientId, batchVersion) {
    const client = await pgPool.connect();
    
    try {
      const operationsTableName = `${tableName.toLowerCase()}_operations`;
      
      const query = `
        SELECT 
          client_id,
          record_id,
          batch_version,
          field_id,
          operation,
          status,
          error_message,
          batch_id,
          created_at,
          processed_at
        FROM ${operationsTableName}
        WHERE record_id = $1 
          AND client_id = $2
          AND batch_version = $3
        ORDER BY processed_at DESC, created_at DESC
        LIMIT 1
      `;
      
      const result = await client.query(query, [recordId, clientId, batchVersion]);
      
      if (result.rows.length > 0) {
        return result.rows[0];
      }
      
      return null;
      
    } catch (error) {
      console.warn(`Error al consultar tabla de operaciones ${tableName}_operations:`, error.message);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * Find operations for multiple records
   * @param {string} tableName - Name of the main table
   * @param {Array<string>} recordIds - Array of record identifiers
   * @param {string} clientId - Client identifier
   * @param {string} batchVersion - Batch version
   * @returns {Promise<Array>} Array of operation records
   */
  async findOperationsByRecords(tableName, recordIds, clientId, batchVersion) {
    if (!recordIds || recordIds.length === 0) return [];
    
    const client = await pgPool.connect();
    
    try {
      const operationsTableName = `${tableName.toLowerCase()}_operations`;
      
      const placeholders = recordIds.map((_, idx) => `$${idx + 1}`).join(', ');
      const values = [...recordIds, clientId, batchVersion];
      
      const query = `
        SELECT 
          client_id,
          record_id,
          batch_version,
          field_id,
          operation,
          status,
          error_message,
          batch_id,
          created_at,
          processed_at
        FROM ${operationsTableName}
        WHERE record_id IN (${placeholders})
          AND client_id = $${recordIds.length + 1}
          AND batch_version = $${recordIds.length + 2}
      `;
      
      const result = await client.query(query, values);
      return result.rows;
      
    } catch (error) {
      console.warn(`Error al consultar operaciones múltiples en ${tableName}_operations:`, error.message);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Find all operations for a specific batch
   * @param {string} tableName - Name of the main table
   * @param {string} batchId - Batch identifier
   * @param {string} clientId - Client identifier
   * @returns {Promise<Array>} Array of operation records
   */
  async findOperationsByBatch(tableName, batchId, clientId) {
    const client = await pgPool.connect();
    
    try {
      const operationsTableName = `${tableName.toLowerCase()}_operations`;
      
      const query = `
        SELECT 
          client_id,
          record_id,
          batch_version,
          field_id,
          operation,
          status,
          error_message,
          input_data,
          batch_id,
          created_at,
          processed_at
        FROM ${operationsTableName}
        WHERE batch_id = $1
          AND client_id = $2
        ORDER BY created_at ASC
      `;
      
      const result = await client.query(query, [batchId, clientId]);
      return result.rows;
      
    } catch (error) {
      console.warn(`Error al consultar operaciones por batch en ${tableName}_operations:`, error.message);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Get operation statistics for a batch
   * @param {string} tableName - Name of the main table
   * @param {string} batchId - Batch identifier
   * @param {string} clientId - Client identifier
   * @returns {Promise<Object>} Statistics object
   */
  async getBatchStatistics(tableName, batchId, clientId) {
    const client = await pgPool.connect();
    
    try {
      const operationsTableName = `${tableName.toLowerCase()}_operations`;
      
      const query = `
        SELECT 
          operation,
          status,
          COUNT(*) as count
        FROM ${operationsTableName}
        WHERE batch_id = $1
          AND client_id = $2
        GROUP BY operation, status
      `;
      
      const result = await client.query(query, [batchId, clientId]);
      
      const stats = {
        total: 0,
        by_operation: {},
        by_status: {}
      };
      
      result.rows.forEach(row => {
        const count = parseInt(row.count);
        stats.total += count;
        
        if (!stats.by_operation[row.operation]) {
          stats.by_operation[row.operation] = 0;
        }
        stats.by_operation[row.operation] += count;
        
        if (!stats.by_status[row.status]) {
          stats.by_status[row.status] = 0;
        }
        stats.by_status[row.status] += count;
      });
      
      return stats;
      
    } catch (error) {
      console.warn(`Error al obtener estadísticas de batch en ${tableName}_operations:`, error.message);
      return { total: 0, by_operation: {}, by_status: {} };
    } finally {
      client.release();
    }
  }

  /**
   * Check if an operation exists for a record
   * @param {string} tableName - Name of the main table
   * @param {string} recordId - Record identifier
   * @param {string} clientId - Client identifier
   * @param {string} batchVersion - Batch version
   * @returns {Promise<boolean>} True if operation exists
   */
  async operationExists(tableName, recordId, clientId, batchVersion) {
    const operation = await this.findOperationByRecord(tableName, recordId, clientId, batchVersion);
    return operation !== null;
  }

  /**
   * Delete operations older than specified days
   * @param {string} tableName - Name of the main table
   * @param {number} daysOld - Number of days
   * @returns {Promise<number>} Number of deleted records
   */
  async deleteOldOperations(tableName, daysOld = 30) {
    const client = await pgPool.connect();
    
    try {
      const operationsTableName = `${tableName.toLowerCase()}_operations`;
      
      const query = `
        DELETE FROM ${operationsTableName}
        WHERE created_at < NOW() - INTERVAL '${daysOld} days'
        RETURNING operation_id
      `;
      
      const result = await client.query(query);
      return result.rowCount;
      
    } catch (error) {
      console.error(`Error al eliminar operaciones antiguas en ${tableName}_operations:`, error.message);
      return 0;
    } finally {
      client.release();
    }
  }
}

module.exports = new OperationsRepository();
